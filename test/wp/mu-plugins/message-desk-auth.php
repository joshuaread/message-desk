<?php
/**
 * Plugin Name: Message Desk Auth
 * Description: Lets Message Desk sign in with an application password on Flywheel, which discards the Authorization header. Also stores each sermon's wordless banner SVG (sermon_banner_svg) and hands it to the sermon template.
 * Version: 1.1.0
 */

add_filter(
	'rest_allowed_cors_headers',
	static function ( $headers ) {
		$headers[] = 'X-Message-Desk';
		return $headers;
	}
);

add_action(
	'plugins_loaded',
	static function () {
		if ( ! empty( $_SERVER['PHP_AUTH_USER'] ) && isset( $_SERVER['PHP_AUTH_PW'] ) ) {
			return;
		}

		$header = '';
		if ( ! empty( $_SERVER['HTTP_X_MESSAGE_DESK'] ) ) {
			$header = (string) $_SERVER['HTTP_X_MESSAGE_DESK'];
		} elseif ( function_exists( 'getallheaders' ) ) {
			foreach ( getallheaders() as $name => $value ) {
				if ( strtolower( (string) $name ) === 'x-message-desk' ) {
					$header = (string) $value;
					break;
				}
			}
		}

		if ( stripos( $header, 'basic ' ) !== 0 ) {
			return;
		}

		$decoded = base64_decode( substr( $header, 6 ), true );
		if ( ! is_string( $decoded ) || ! str_contains( $decoded, ':' ) ) {
			return;
		}

		list( $user, $pass ) = explode( ':', $decoded, 2 );
		$_SERVER['PHP_AUTH_USER']    = $user;
		$_SERVER['PHP_AUTH_PW']      = $pass;
		$_SERVER['HTTP_AUTHORIZATION'] = 'Basic ' . substr( $header, 6 );
	},
	0
);

/*
 * Per-sermon banner art (added in 1.1.0; the auth code above is unchanged).
 *
 * Message Desk sends the wordless 1120x240 banner SVG it picked as the
 * `sermon_banner_svg` meta. It is sanitized on save to a small SVG subset and
 * printed on single sermon pages inside <template id="cs-banner-svg">, which
 * the sermon template script uses before its passage/default banners.
 */

/** Max stored banner size in bytes; the motif banners are ~1-3 KB. */
const MESSAGE_DESK_BANNER_MAX = 20000;

/** wp_kses allowlist for banner SVGs. Keys are lowercase, as kses compares them. */
function message_desk_banner_allowed_html() {
	$attrs = array_fill_keys(
		array(
			'xmlns', 'viewbox', 'preserveaspectratio', 'role', 'id', 'd',
			'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
			'stroke-linecap', 'transform', 'cx', 'cy', 'r', 'x', 'y', 'width',
			'height', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color',
			'patternunits', 'patterntransform',
		),
		true
	);
	$tags = array( 'svg', 'defs', 'lineargradient', 'stop', 'pattern', 'rect', 'circle', 'path', 'g' );
	return array_fill_keys( $tags, $attrs );
}

/** Reduce a value to the safe banner SVG subset, or '' if it is not one. */
function message_desk_sanitize_banner_svg( $value ) {
	if ( ! is_string( $value ) ) {
		return '';
	}
	$value = trim( $value );
	if ( '' === $value || strlen( $value ) > MESSAGE_DESK_BANNER_MAX ) {
		return '';
	}
	// Drop an XML prolog / comments before kses so only markup remains.
	$value = preg_replace( '/<\?xml.*?\?>|<!--.*?-->/s', '', $value );
	$clean = trim( wp_kses( $value, message_desk_banner_allowed_html(), array( 'http', 'https' ) ) );
	// kses lowercases names and writes "<x />"; restore SVG camelCase so the
	// stored value is clean SVG (browsers would also fix the case on parse).
	$clean = str_replace(
		array( ' viewbox=', ' preserveaspectratio=', ' patternunits=', ' patterntransform=', '<lineargradient', '</lineargradient>', ' />' ),
		array( ' viewBox=', ' preserveAspectRatio=', ' patternUnits=', ' patternTransform=', '<linearGradient', '</linearGradient>', '/>' ),
		$clean
	);
	// Must still be exactly one <svg>...</svg> document after cleaning.
	if ( ! preg_match( '/^<svg[\s>].*<\/svg>$/is', $clean ) || substr_count( strtolower( $clean ), '<svg' ) !== 1 ) {
		return '';
	}
	return $clean;
}

add_action(
	'init',
	static function () {
		register_post_meta(
			'sermon',
			'sermon_banner_svg',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'default'           => '',
				'sanitize_callback' => 'message_desk_sanitize_banner_svg',
				'auth_callback'     => static function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
);

/** Print the stored banner once on single sermon pages (body open, footer as fallback). */
function message_desk_print_banner_svg() {
	static $done = false;
	if ( $done || ! is_singular( 'sermon' ) ) {
		return;
	}
	$done = true;
	$svg  = message_desk_sanitize_banner_svg( (string) get_post_meta( get_queried_object_id(), 'sermon_banner_svg', true ) );
	if ( '' === $svg ) {
		return;
	}
	echo '<template id="cs-banner-svg">' . $svg . '</template>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- kses-sanitized above.
}
add_action( 'wp_body_open', 'message_desk_print_banner_svg' );
add_action( 'wp_footer', 'message_desk_print_banner_svg' );
