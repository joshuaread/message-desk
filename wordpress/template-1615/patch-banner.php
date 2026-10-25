<?php
/**
 * One-time patch for the citizenschur.ch sermon template (wp_template id 1615):
 * make the inline banner script use the per-sermon banner printed by
 * message-desk-auth.php (<template id="cs-banner-svg">) before falling back to
 * the passage banners (PB) and the Jonah/arches defaults.
 *
 *   php patch-banner.php [in=/tmp/tpl.html] [out=/tmp/tpl-new.html] [--minimal]
 *
 * Why the default also drops `has-img`: when a sermon has a featured image the
 * page puts `has-img` on .cs-single, and the site CSS then hides the banner SVG
 * (.has-img .cs-art svg{display:none!important}) and shows the featured image
 * cover-cropped instead. With a 1920x1080 scene that crop is mostly empty sky
 * (this is what post 2412 shows today, hiding the 'jonah1:17' whale). So when
 * there is explicit art (a custom banner or a PAB passage key) the default
 * patch removes `has-img` and shows that art; sermons without explicit art keep
 * the featured-image background exactly as before. --minimal applies only the
 * literal custom-banner lookup, with no has-img change.
 *
 * Fails loudly (exit 1, nothing written) unless the needle occurs exactly once.
 * Refuses to run twice on already-patched content.
 */
$args    = array_values( array_filter( array_slice( $argv, 1 ), static fn( $a ) => '--minimal' !== $a ) );
$minimal = in_array( '--minimal', $argv, true );
$in      = $args[0] ?? '/tmp/tpl.html';
$out     = $args[1] ?? '/tmp/tpl-new.html';

$needle      = "art.innerHTML=PB(passage)||(key==='jonah'?JONAHB:ARCHB);";
$replacement = $minimal
	? "var cb=document.getElementById('cs-banner-svg');art.innerHTML=(cb&&cb.innerHTML.trim())||PB(passage)||(key==='jonah'?JONAHB:ARCHB);"
	: "var cb=document.getElementById('cs-banner-svg'),cba=(cb&&cb.innerHTML.trim())||PB(passage);if(cba){s.classList.remove('has-img')}art.innerHTML=cba||(key==='jonah'?JONAHB:ARCHB);";

$src = @file_get_contents( $in );
if ( false === $src || '' === $src ) {
	fwrite( STDERR, "ERROR: cannot read template content from $in\n" );
	exit( 1 );
}
if ( str_contains( $src, "getElementById('cs-banner-svg')" ) ) {
	fwrite( STDERR, "ERROR: $in is already patched (cs-banner-svg lookup present); nothing to do.\n" );
	exit( 1 );
}
$count = substr_count( $src, $needle );
if ( 1 !== $count ) {
	fwrite( STDERR, "ERROR: expected the needle exactly once in $in, found $count:\n  $needle\n" );
	exit( 1 );
}
$new = str_replace( $needle, $replacement, $src );
if ( strlen( $new ) !== strlen( $src ) - strlen( $needle ) + strlen( $replacement ) || 1 !== substr_count( $new, $replacement ) ) {
	fwrite( STDERR, "ERROR: replacement sanity check failed; nothing written.\n" );
	exit( 1 );
}
if ( false === file_put_contents( $out, $new ) ) {
	fwrite( STDERR, "ERROR: cannot write $out\n" );
	exit( 1 );
}
echo "OK (" . ( $minimal ? 'minimal' : 'default' ) . "): patched 1 occurrence; wrote $out (" . strlen( $new ) . " bytes, +" . ( strlen( $new ) - strlen( $src ) ) . ")\n";
