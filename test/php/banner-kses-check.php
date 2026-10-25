<?php
/**
 * Offline check of the sermon_banner_svg sanitizer in
 * wordpress/message-desk-auth.php against real WordPress kses.
 *
 *   WP_CORE=/path/to/wordpress npm run test:php
 *   (or: php test/php/banner-kses-check.php /path/to/wordpress banners.json)
 *
 * banners.json: {"motif": "<svg ...>", ...} (every Message Desk motif). Each
 * must survive sanitizing unchanged; hostile inputs must be stripped.
 */
$wp = rtrim( $argv[1] ?? '', '/' );
if ( ! is_file( "$wp/wp-includes/kses.php" ) ) {
	fwrite( STDERR, "usage: php banner-kses-check.php /path/to/wordpress banners.json\n" );
	exit( 2 );
}
define( 'ABSPATH', "$wp/" );
define( 'WPINC', 'wp-includes' );
require "$wp/wp-includes/plugin.php";
require "$wp/wp-includes/formatting.php";
require "$wp/wp-includes/kses.php";
// Newer kses uses the HTML API; autoload its classes from wp-includes/html-api.
spl_autoload_register(
	static function ( $class ) use ( $wp ) {
		$file = "$wp/wp-includes/html-api/class-" . str_replace( '_', '-', strtolower( $class ) ) . '.php';
		if ( is_file( $file ) ) {
			require $file;
		}
	}
);
// Minimal stubs for the bits of WordPress the plugin touches.
function get_option( $k, $d = false ) { return 'blog_charset' === $k ? 'UTF-8' : $d; }
function wp_allowed_protocols() { return array( 'http', 'https' ); }
$GLOBALS['registered'] = array();
function register_post_meta( $type, $key, $args ) { $GLOBALS['registered'][ "$type:$key" ] = $args; return true; }
function current_user_can( $c ) { return 'edit_posts' === $c; }
$GLOBALS['meta'] = '';
function is_singular( $t = '' ) { return 'sermon' === $t; }
function get_queried_object_id() { return 1; }
function get_post_meta( $id, $key, $single ) { return $GLOBALS['meta']; }

require __DIR__ . '/../../wordpress/message-desk-auth.php';
do_action( 'init' );

$fail = 0;
$ok   = static function ( $cond, $msg ) use ( &$fail ) {
	echo ( $cond ? 'ok   ' : 'FAIL ' ) . $msg . "\n";
	if ( ! $cond ) {
		$fail++;
	}
};

$reg = $GLOBALS['registered']['sermon:sermon_banner_svg'] ?? null;
$ok( is_array( $reg ) && true === $reg['show_in_rest'] && true === $reg['single'] && 'string' === $reg['type'], 'meta registered (string, single, show_in_rest)' );
$ok( is_array( $reg ) && true === call_user_func( $reg['auth_callback'] ), 'auth_callback checks edit_posts' );

$banners = json_decode( (string) file_get_contents( $argv[2] ?? '' ), true ) ?: array();
$ok( count( $banners ) > 0, 'loaded ' . count( $banners ) . ' motif banners' );
foreach ( $banners as $motif => $svg ) {
	$ok( message_desk_sanitize_banner_svg( $svg ) === $svg, "motif $motif survives sanitizing unchanged" );
}

$hostile = array(
	'script tag'      => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 240"><script>alert(1)</script><rect width="1" height="1"/></svg>',
	'onload attr'     => '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 1120 240"><rect width="1" height="1"/></svg>',
	'foreignObject'   => '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
	'use href'        => '<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)"/></svg>',
	'style attr'      => '<svg xmlns="http://www.w3.org/2000/svg"><rect style="background:url(javascript:alert(1))" width="1" height="1"/></svg>',
	'breakout'        => '<svg xmlns="http://www.w3.org/2000/svg"></svg></template><script>alert(1)</script>',
);
foreach ( $hostile as $name => $svg ) {
	$out = message_desk_sanitize_banner_svg( $svg );
	$ok( ! preg_match( '/script|onload|onerror|foreignobject|<use|style=|javascript|<\/template/i', $out ), "hostile '$name' neutralised -> " . ( '' === $out ? "''" : $out ) );
}
$ok( '' === message_desk_sanitize_banner_svg( 'not svg' ), 'non-svg -> empty' );
$ok( '' === message_desk_sanitize_banner_svg( array( 'x' ) ), 'non-string -> empty' );
$ok( '' === message_desk_sanitize_banner_svg( '<svg>' . str_repeat( '<g></g>', 4000 ) . '</svg>' ), 'oversize -> empty' );

// Output: printed once inside <template>, nothing when empty.
$GLOBALS['meta'] = reset( $banners );
ob_start();
do_action( 'wp_body_open' );
do_action( 'wp_footer' );
$html = ob_get_clean();
$ok( substr_count( $html, '<template id="cs-banner-svg">' ) === 1 && str_contains( $html, $GLOBALS['meta'] ), 'printed once in <template id="cs-banner-svg">' );

echo $fail ? "\n$fail FAILED\n" : "\nall passed\n";
exit( $fail ? 1 : 0 );
