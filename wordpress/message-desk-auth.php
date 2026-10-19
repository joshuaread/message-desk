<?php
/**
 * Plugin Name: Message Desk Auth
 * Description: Lets Message Desk sign in with an application password on Flywheel, which discards the Authorization header.
 * Version: 1.0.0
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
