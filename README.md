# Message Desk

Sunday sermon desk for Citizens Church. Drop a board WAV, trim the sermon, clean a mono MP3, and post a draft to [citizenschur.ch](https://citizenschur.ch).

The live page is [joshuaread.github.io/message-desk](https://joshuaread.github.io/message-desk/). GitHub Pages has no server, so Transcribe and Suggest do not run there. Trim, the MP3, download, and the WordPress post do.

WordPress username and application password stay in the browser. They are not in this repo.

## Run it yourself

```bash
npm install
npm run dev
```

Transcription needs `XAI_API_KEY` in the environment of whatever machine runs the server. Create the key in the [xAI Console](https://console.x.ai/) under API Keys.
