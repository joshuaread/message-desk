<?php
/**
 * Plugin Name: Test — mimic Flywheel (strip Authorization)
 * Description: Deletes the Authorization header and PHP_AUTH_* so the ONLY way
 *   to authenticate is the X-Message-Desk fallback mapped by
 *   message-desk-auth.php. This makes the throwaway test exercise exactly the
 *   Flywheel code path the real site needs. Loads before message-desk-auth.php
 *   (alphabetical "00-").
 */

// Runs at include time, before plugins_loaded, so WordPress never sees the
// standard Basic auth credentials — just like Flywheel in production.
unset(
	$_SERVER['PHP_AUTH_USER'],
	$_SERVER['PHP_AUTH_PW'],
	$_SERVER['HTTP_AUTHORIZATION'],
	$_SERVER['REDIRECT_HTTP_AUTHORIZATION']
);
