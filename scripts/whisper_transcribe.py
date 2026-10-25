#!/usr/bin/env python3
"""Local transcription fallback using faster-whisper.

Reads an audio file and prints a JSON object to stdout:
  {"text": "...", "duration": 123.4, "words": [{"text","start","end"}, ...]}

Invoked by the server as:
  <WHISPER_PYTHON> whisper_transcribe.py --input FILE --model base.en
"""
import argparse
import json
import subprocess
import sys


def decode_audio(path: str, rate: int = 16000):
    """Decode any audio to mono float32 at `rate` via ffmpeg.

    Done here (not through faster-whisper's internal decoder) so the tool works
    regardless of the installed PyAV version.
    """
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path,
         "-f", "f32le", "-ac", "1", "-ar", str(rate), "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", default="base.en")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - env specific
        print(json.dumps({"error": f"faster-whisper not available: {exc}"}))
        return 2

    audio = decode_audio(args.input)
    # cpu_threads=1 + temperature 0 (no random fallback schedule) + beam 5 keeps
    # the output deterministic for a given input. vad_filter trims long silences.
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=1)
    segments, info = model.transcribe(
        audio,
        language="en",
        word_timestamps=True,
        vad_filter=True,
        temperature=0.0,
        beam_size=5,
        condition_on_previous_text=False,
    )

    words = []
    text_parts = []
    for segment in segments:
        text_parts.append(segment.text)
        if segment.words:
            for w in segment.words:
                token = (w.word or "").strip()
                if not token:
                    continue
                words.append(
                    {"text": token, "start": float(w.start or 0.0), "end": float(w.end or 0.0)}
                )

    result = {
        "text": "".join(text_parts).strip(),
        "duration": float(getattr(info, "duration", 0.0) or 0.0),
        "words": words,
    }
    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
