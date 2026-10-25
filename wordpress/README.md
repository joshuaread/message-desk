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
