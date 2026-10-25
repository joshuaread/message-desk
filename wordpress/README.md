# WordPress side

## `message-desk-auth.php` (required on Flywheel)

Citizens Church is hosted on Flywheel, which **strips the `Authorization`
header** before PHP sees it — so a normal WordPress Application Password login
over the REST API returns `401 rest_not_logged_in`, even with correct
credentials.

Message Desk works around this by sending the Basic credentials **twice** on
every request: the standard `Authorization: Basic …` header *and* a
`X-Message-Desk: Basic …` header. This mu-plugin runs early
(`plugins_loaded`, priority 0) and, when it sees that WordPress has no
`PHP_AUTH_USER` yet, copies the credentials out of `X-Message-Desk` into the
place WordPress expects. On normal hosts the standard header already works and
this plugin does nothing.

### Install

It is a **must-use** plugin — copy it into `wp-content/mu-plugins/` so it is
always active and cannot be deactivated by accident:

```
wp-content/mu-plugins/message-desk-auth.php
```

On Flywheel you can upload it via SFTP or the Flywheel file manager. No
activation step is needed for mu-plugins. To confirm it is working, click
**Check site & login** in the desk — it should report the signed-in user and
capabilities instead of a login error.

## Expected site shape

Message Desk targets the real site's structure (see `../` task notes):

- a `sermon` custom post type (`rest_base` `sermon`, public URL `/messages/<slug>/`),
- five `sermon_*` meta fields registered with `show_in_rest`:
  `sermon_speaker`, `sermon_scripture`, `sermon_series`, `sermon_audio_url`,
  `sermon_transcript`,
- the theme renders the audio player from `sermon_audio_url` (so the desk does
  **not** put an audio block in the post content),
- no SEO plugin — Yoast/RankMath meta is written only if those plugins are
  detected.

The throwaway test WordPress reproduces this exactly; see
`../test/wp/mu-plugins/` for the fixture.

## Per-sermon banners (`message-desk-auth.php` 1.1.0)

The same mu-plugin (auth code unchanged) also:

- registers `sermon_banner_svg` on `sermon` (string, single, `show_in_rest`,
  writable by users who can `edit_posts`). Message Desk sends the wordless
  1120x240 banner the user picked in the image step, with per-sermon gradient
  ids (e.g. `csb-<jobid>`). Unknown meta keys are ignored by WordPress, so the
  desk is safe to run before this plugin is deployed.
- sanitizes it on save with `wp_kses` to a small SVG subset (svg, defs,
  linearGradient, stop, pattern, rect, circle, path, g; geometry/paint
  attributes only; no script, style, href, or event attributes). Anything that
  is not a single clean `<svg>` is stored as `''`.
- prints it on single sermon pages as `<template id="cs-banner-svg">…</template>`
  (at `wp_body_open`, `wp_footer` as fallback), only when non-empty.

Offline check against real WordPress kses: `WP_CORE=/path/to/wordpress npm run test:php`.

### One-time template change (wp_template 1615)

`template-1615/patch-banner.php` patches the sermon template's inline script so
the banner comes from `#cs-banner-svg` first, then the passage banners (`PB`),
then the Jonah/arches defaults:

```
php wordpress/template-1615/patch-banner.php /tmp/tpl.html /tmp/tpl-new.html
```

It exits 1 and writes nothing unless the needle occurs exactly once (or if the
content is already patched). By default it also removes `has-img` when there is
explicit art: with a featured image the site CSS hides the banner SVG and shows
the featured image cover-cropped, which for the 1920x1080 scene is mostly empty
sky. `--minimal` applies only the literal lookup.
