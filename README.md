# Message Desk

One always-on Node server that turns a raw Sunday recording into a published
sermon on the Citizens Church WordPress site — **every step runs server-side**,
driven from a single phone-friendly page.

Upload the phone or board recording → it finds the message inside the worship
and announcements → cleans and loudness-normalizes it → transcribes it → writes
the title/SEO → builds a branded featured image → and publishes (draft by
default) to WordPress with the audio, image, and sermon metadata in place.

## What it does

1. **Upload** `.m4a` (AAC phone recordings), `.wav` (any depth/rate, stereo,
   1 GB+), or `.mp3`. Uploads stream to disk; nothing is buffered whole in
   memory. ffmpeg must be on `PATH` (checked at startup).
2. **Find the message.** ffmpeg decodes the whole file to low-rate mono PCM; the
   server computes per-second features — RMS, zero-crossing rate, and
   ~syllable-rate (4 Hz) energy modulation — classifies each second as
   speech / music / silence, and picks the longest sustained speech region
   (bridging short pauses). The UI shows a server-computed waveform with
   draggable in/out handles, ±1 s / ±5 s nudge buttons, numeric inputs, and
   region preview playback. Returns in/out seconds + a confidence.
3. **Clean & export.** Trim → mono → high-pass ~80 Hz → denoise (`afftdn`) →
   **two-pass `loudnorm` to I=−16 LUFS, TP=−1.5, LRA=11** → a true-peak limiter
   (`alimiter`) → short fades → 44.1 kHz mono MP3 (libmp3lame, 112 kbps). The
   finished MP3 is **measured** with `ebur128 (peak=true)`; the step fails loudly
   if integrated loudness is outside −16 ±1 LUFS or the true peak exceeds
   −1.5 dBTP.
4. **Transcribe.** xAI STT (`grok-voice-transcribe-2.0`) when `XAI_API_KEY` is
   set; on a missing key or any xAI error it falls back to local
   **faster-whisper** (`WHISPER_PYTHON`, model `WHISPER_MODEL`, deterministic:
   temperature 0, beam 5, VAD). It always reports which engine produced the
   transcript and why (e.g. `whisper (xAI rejected: 400)`), and builds readable
   paragraphs from the word timings.
5. **Featured image.** A branded 1920×1080 SVG (Citizens Church look — dark
   charcoal, warm gold accent, off-white Poppins) rasterized to PNG + JPG with
   `@resvg/resvg-js` using the **bundled** Poppins OFL fonts, so it renders the
   same on a bare server. Long titles wrap. The PNG is uploaded with alt text
   (WordPress rejects SVG).
6. **SEO.** xAI chat completions (`XAI_MODEL`, default `grok-4.7`,
   `json_object`) writes a real title (never the first spoken sentence), slug,
   meta description (≤155), a two-sentence excerpt, body summary, normalized
   scripture refs, speaker/series, tags/categories, focus keyphrase, and image
   alt text. If the key is missing or the call fails, a deterministic heuristic
   fallback kicks in (scripture regex for all 66 books incl. spoken forms like
   "Jonah chapter one verses seven through sixteen"; topic-themed titles). The
   engine (`xai` | `heuristic`) and any error are reported. All fields are
   editable before posting.
7. **Publish to WordPress.** Credentials come from **server env only** — never
   sent to or through the browser, never logged. Every request carries both
   `Authorization: Basic …` and `X-Message-Desk: Basic …` so it works on
   Flywheel (which strips `Authorization`; see
   [`wordpress/README.md`](wordpress/README.md)). The server probes the site
   (namespaces, `sermon` post type, Yoast/RankMath), uploads the MP3 and the PNG
   featured image, and creates a `sermon` post (falling back to a core `post`
   with an audio block only if `sermon` doesn't exist) with title, slug, service
   date, excerpt, transcript paragraphs, `featured_media`, and the `sermon_*`
   meta. **Draft is the default; publishing is a separate explicit action**
   (`{"publish": true, "confirm": "publish"}`). SEO-plugin meta is written only
   when that plugin is detected, and the response reports which meta WordPress
   actually kept.

Jobs live under `DATA_DIR` (one directory each, with a `job.json` state file).
Jobs older than 7 days are cleaned up at startup.

## Run it locally

```bash
cp .env.example .env     # then edit .env
npm ci
npm start                # http://localhost:8080
```

`npm run build` exists but is a no-op — this is plain modern JavaScript (ESM),
so `npm start` just runs `node server/index.js`. Dev auto-reload:
`npm run dev`.

Requirements: **Node ≥ 20** and **ffmpeg/ffprobe on `PATH`**. Transcription uses
`XAI_API_KEY` if set, otherwise a local faster-whisper interpreter at
`WHISPER_PYTHON`.

## Tests

```bash
npm test     # unit tests (detection, scripture, slugify, SEO, both guards)
npm run e2e  # full pipeline against a throwaway WordPress (WP Playground)
```

`npm run e2e` boots a disposable WordPress with WP Playground CLI (no Docker),
generates a synthetic service recording, drives the whole pipeline through the
real browser UI (Playwright), publishes a sermon, and verifies the public page
renders the audio player + featured image and that the REST post carries the
`sermon_*` meta. It writes evidence (summary JSON, the generated SVG/PNG, and
screenshots) to `evidence/`. The tests **refuse to run against the real site**:
any `WP_URL` on `citizenschur.ch` is rejected.

`npm run make-audio` regenerates the synthetic test recording on its own.

## Deploy on the Mac Pro

Target: Josh's always-on Ubuntu Mac Pro, reachable on the LAN / Tailscale.

1. **System deps.**
   ```bash
   sudo apt update
   sudo apt install -y ffmpeg
   # Node 20+ (via nodesource or nvm); verify:
   node --version   # >= 20
   ```
   Optional local transcription fallback (used only if xAI is unavailable):
   ```bash
   python3 -m venv /opt/whisper-venv
   /opt/whisper-venv/bin/pip install faster-whisper
   # then set WHISPER_PYTHON=/opt/whisper-venv/bin/python
   ```

2. **Get the code.**
   ```bash
   sudo mkdir -p /opt/message-desk
   sudo chown "$USER" /opt/message-desk
   git clone <this repo> /opt/message-desk
   cd /opt/message-desk
   npm ci
   mkdir -p data
   ```

3. **Config / secrets** — kept out of the repo, in `/etc/message-desk/env`:
   ```bash
   sudo mkdir -p /etc/message-desk
   sudo cp .env.example /etc/message-desk/env
   sudo nano /etc/message-desk/env      # fill in XAI_API_KEY, WP_APP_PASSWORD, …
   sudo chmod 600 /etc/message-desk/env
   ```
   Set at least `XAI_API_KEY`, `WP_URL=https://citizenschur.ch`,
   `WP_USER=josh`, and `WP_APP_PASSWORD` (a WordPress Application
   Password). Set `DESK_PASSWORD` to require a login for the UI, and
   `TZ=America/Chicago` for the default service date.

4. **Install the Flywheel auth mu-plugin** on the live site — copy
   `wordpress/message-desk-auth.php` to the site's
   `wp-content/mu-plugins/message-desk-auth.php` (via SFTP / Flywheel file
   manager). See [`wordpress/README.md`](wordpress/README.md). Without it,
   Flywheel strips the login header and publishing returns 401.

5. **systemd service.**
   ```bash
   sudo cp deploy/message-desk.service /etc/systemd/system/message-desk.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now message-desk
   sudo systemctl status message-desk
   ```
   It binds `0.0.0.0:8080` (set `PORT` to change) and restarts on failure.

6. **Reach it.** On the LAN: `http://<mac-pro-ip>:8080`. Over Tailscale:
   `http://<tailscale-name>:8080`. If `DESK_PASSWORD` is set, log in as user
   `desk` with that password.

### Updating

```bash
cd /opt/message-desk && git pull && npm ci && sudo systemctl restart message-desk
```

## Layout

```
server/      the Node/Express app (one module per pipeline step)
public/      the single-page UI (no build step)
assets/fonts bundled Poppins OFL fonts for the featured image
scripts/     whisper fallback, test-audio generator, WP Playground harness, e2e
test/wp/     throwaway-WordPress mu-plugin fixtures (sermon CPT, theme render)
tests/       node:test unit tests
deploy/      systemd unit
wordpress/   the Flywheel auth mu-plugin + notes
```
