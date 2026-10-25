<?php
/**
 * Plugin Name: Test — Citizens sermon fixture
 * Description: Mimics citizenschur.ch on a throwaway WordPress: the `sermon`
 *   CPT, the five sermon_* meta, and a single-sermon theme header rendered by a
 *   the_content filter. Also enables application passwords over http, permits
 *   mp3/png uploads, and exposes the test user's app password at
 *   /wp-json/desk-test/v1/creds so the e2e can log in. THROWAWAY TEST ONLY.
 */

// Application passwords normally require SSL; force the local environment so
// they work over http on 127.0.0.1.
if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) {
	define( 'WP_ENVIRONMENT_TYPE', 'local' );
}
add_filter( 'wp_is_application_passwords_available', '__return_true' );
add_filter( 'wp_is_application_passwords_available_for_user', '__return_true' );

// Permit the uploads the desk makes, and trust the declared type (php-wasm has
// no libmagic, so skip the real-mime cross-check for our known types).
add_filter(
	'upload_mimes',
	static function ( $mimes ) {
		$mimes['mp3']  = 'audio/mpeg';
		$mimes['png']  = 'image/png';
		$mimes['jpg']  = 'image/jpeg';
		$mimes['jpeg'] = 'image/jpeg';
		return $mimes;
	}
);
add_filter(
	'wp_check_filetype_and_ext',
	static function ( $data, $file, $filename ) {
		if ( ! empty( $data['ext'] ) && ! empty( $data['type'] ) ) {
			return $data;
		}
		$map = array(
			'mp3'  => 'audio/mpeg',
			'png'  => 'image/png',
			'jpg'  => 'image/jpeg',
			'jpeg' => 'image/jpeg',
		);
		$ext = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
		if ( isset( $map[ $ext ] ) ) {
			return array( 'ext' => $ext, 'type' => $map[ $ext ], 'proper_filename' => false );
		}
		return $data;
	},
	10,
	3
);

// --- The `sermon` CPT, matching the real site's registration ---------------
add_action(
	'init',
	static function () {
		register_post_type(
			'sermon',
			array(
				'label'        => 'Sermons',
				'public'       => true,
				'show_in_rest' => true,
				'rest_base'    => 'sermon',
				'has_archive'  => false,
				'menu_icon'    => 'dashicons-microphone',
				'rewrite'      => array( 'slug' => 'messages', 'with_front' => false ),
				'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields' ),
			)
		);

		$meta_keys = array(
			'sermon_speaker',
			'sermon_scripture',
			'sermon_series',
			'sermon_audio_url',
			'sermon_transcript',
		);
		foreach ( $meta_keys as $key ) {
			register_post_meta(
				'sermon',
				$key,
				array(
					'type'          => 'string',
					'single'        => true,
					'show_in_rest'  => true,
					'auth_callback' => static function () {
						return current_user_can( 'edit_posts' );
					},
				)
			);
		}

		// Pretty permalinks so /messages/<slug>/ resolves like the live site.
		if ( get_option( 'permalink_structure' ) !== '/%postname%/' ) {
			update_option( 'permalink_structure', '/%postname%/' );
		}
		if ( ! get_option( 'desk_test_flushed' ) ) {
			flush_rewrite_rules( false );
			update_option( 'desk_test_flushed', 1 );
		}

		// Ensure the test editor + an application password exist.
		$login = 'deskbot';
		$user  = get_user_by( 'login', $login );
		if ( ! $user ) {
			$uid = wp_insert_user(
				array(
					'user_login' => $login,
					'user_pass'  => wp_generate_password( 24, true ),
					'user_email' => 'deskbot@example.test',
					'role'       => 'editor',
				)
			);
			if ( ! is_wp_error( $uid ) ) {
				$user = get_user_by( 'id', $uid );
			}
		}
		if ( $user && ! get_option( 'desk_test_app_pw' ) && class_exists( 'WP_Application_Passwords' ) ) {
			$created = WP_Application_Passwords::create_new_application_password(
				$user->ID,
				array( 'name' => 'Message Desk Test' )
			);
			if ( ! is_wp_error( $created ) && isset( $created[0] ) ) {
				update_option( 'desk_test_app_pw', $created[0] );
			}
		}
	},
	5
);

// --- Single-sermon theme render (the theme builds this, not post content) ---
add_filter(
	'the_content',
	static function ( $content ) {
		if ( ! is_singular( 'sermon' ) || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}
		$id        = get_the_ID();
		$img       = get_the_post_thumbnail_url( $id, 'full' );
		$speaker   = get_post_meta( $id, 'sermon_speaker', true );
		$scripture = get_post_meta( $id, 'sermon_scripture', true );
		$series    = get_post_meta( $id, 'sermon_series', true );
		$audio     = get_post_meta( $id, 'sermon_audio_url', true );
		$date      = get_the_date( 'F j, Y', $id );

		$bits = array_filter(
			array( $date, $speaker, $scripture, $series ? 'Series: ' . $series : '' )
		);

		$head  = '<div class="cs-single' . ( $img ? ' has-img' : '' ) . '"';
		if ( $img ) {
			$head .= ' style="--cs-img:url(\'' . esc_url( $img ) . '\')"';
		}
		$head .= '>';
		$head .= '<h1 class="cs-title">' . esc_html( get_the_title( $id ) ) . '</h1>';
		$head .= '<p class="cs-meta">' . esc_html( implode( ' · ', $bits ) ) . '</p>';
		if ( $audio ) {
			$head .= do_shortcode( '[audio src="' . esc_url( $audio ) . '"]' );
			$head .= '<p class="cs-meta"><a href="' . esc_url( $audio ) . '" download>Download audio</a></p>';
		}
		$head .= '</div>';

		return $head . $content;
	},
	20
);

// --- Expose the test app password so the e2e can authenticate --------------
add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'desk-test/v1',
			'/creds',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => static function () {
					return array(
						'user'     => 'deskbot',
						'password' => get_option( 'desk_test_app_pw', '' ),
					);
				},
			)
		);
	}
);
