import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Pause, Play, RotateCcw, Sparkles, Upload } from "lucide-react";
import { detectSermon, type Detection } from "@/lib/audio/detect";
import { encodeSermonMp3, bytesToBase64, type CleanOptions } from "@/lib/audio/encode";
import { makeSampleService } from "@/lib/audio/sample";
import { analyzeWav, fileSource, type Analysis } from "@/lib/audio/wav";
import { suggestSermon, transcribeAudio } from "@/lib/ai";
import {
  confidenceLabel,
  formatBytes,
  formatCost,
  formatDuration,
  formatTime,
  localDateInput,
  parseTime,
  sermonFileName,
} from "@/lib/format";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type DeskSettings, type PostStatus } from "@/lib/settings";
import { clipForSuggestion, planChunks, sermonKeyterms, wordsToTranscript } from "@/lib/transcript";
import { Waveform } from "@/components/waveform";
import {
  adminEditUrl,
  createSermon,
  fetchRecentSermons,
  testConnection,
  uploadMedia,
  type RecentSermon,
} from "@/lib/wordpress";

type Loaded = {
  name: string;
  analysis: Analysis;
  detection: Detection;
  url: string;
};

type SermonMeta = {
  title: string;
  speaker: string;
  scripture: string;
  series: string;
  summary: string;
  transcript: string;
  date: string;
  time: string;
  status: PostStatus;
};

type PublishResult = {
  id: number;
  link: string;
  status: string;
  audioSaved: boolean;
  admin: string;
};

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none focus:border-gold";

function cleanDefaults(): CleanOptions {
  return { cutRumble: true, tightenQuiet: true, normalize: true, bitrate: 96 };
}

export function Desk() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<ReturnType<typeof fileSource> | null>(null);
  const loadToken = useRef(0);
  const startRef = useRef(0);
  const endRef = useRef(0);
  const stopRef = useRef(true);

  const [settings, setSettings] = useState<DeskSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [recent, setRecent] = useState<RecentSermon[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<{ ratio: number; label: string } | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stopAtOut, setStopAtOut] = useState(true);
  const [startText, setStartText] = useState("0:00.0");
  const [endText, setEndText] = useState("0:00.0");
  const startFocused = useRef(false);
  const endFocused = useRef(false);
  const [clean, setClean] = useState<CleanOptions>(cleanDefaults);
  const [mp3, setMp3] = useState<{ blob: Blob; key: string; filename: string } | null>(null);
  const [meta, setMeta] = useState<SermonMeta>({
    title: "",
    speaker: "",
    scripture: "",
    series: "",
    summary: "",
    transcript: "",
    date: "",
    time: "10:00",
    status: "draft",
  });
  const [transcriptKey, setTranscriptKey] = useState<string | null>(null);
  const [connectionNote, setConnectionNote] = useState("");
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [logoOk, setLogoOk] = useState(true);

  startRef.current = start;
  endRef.current = end;
  stopRef.current = stopAtOut;

  useEffect(() => {
    const next = loadSettings();
    setSettings(next);
    setMeta((current) => ({
      ...current,
      speaker: current.speaker || next.speaker,
      series: current.series || next.series,
      time: next.serviceTime || "10:00",
      status: next.status,
    }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSettings(settings);
  }, [settings, hydrated]);

  useEffect(() => {
    let cancelled = false;
    setRecent(null);
    fetchRecentSermons(settings.siteUrl)
      .then((items) => {
        if (!cancelled) setRecent(items);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.siteUrl]);

  useEffect(() => {
    if (!startFocused.current) setStartText(formatTime(start));
  }, [start]);

  useEffect(() => {
    if (!endFocused.current) setEndText(formatTime(end));
  }, [end]);

  useEffect(() => {
    return () => {
      if (loaded?.url) URL.revokeObjectURL(loaded.url);
    };
  }, [loaded?.url]);

  const loadFromFile = useCallback((file: File) => {
    const token = loadToken.current + 1;
    loadToken.current = token;
    setError("");
    setPublished(null);
    setMp3(null);
    setProgress({ ratio: 0, label: "Reading the recording" });
    setPlaying(false);
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".wav") && !lower.endsWith(".wave") && file.type && !file.type.includes("wav")) {
      setProgress(null);
      setError("Drop the WAV from the recorder. MP3 and phone voice memos skip the board mix this desk is built for.");
      return;
    }
    const url = URL.createObjectURL(file);
    const source = fileSource(file);
    sourceRef.current = source;
    void analyzeWav(source, {
      onProgress: (ratio) => {
        if (loadToken.current === token) setProgress({ ratio, label: "Finding the sermon" });
      },
    })
      .then((analysis) => {
        if (loadToken.current !== token) {
          URL.revokeObjectURL(url);
          return;
        }
        const detection = detectSermon(analysis.features, analysis.duration);
        setLoaded({ name: file.name, analysis, detection, url });
        setStart(detection.start);
        setEnd(detection.end);
        setNow(detection.start);
        setTranscriptKey(null);
        setMeta((current) => ({
          ...current,
          title: "",
          scripture: "",
          summary: "",
          transcript: "",
          speaker: current.speaker || settings.speaker,
          series: current.series || settings.series,
          date: localDateInput(file.lastModified),
          time: current.time || settings.serviceTime || "10:00",
          status: settings.status,
        }));
        setProgress(null);
        const audio = audioRef.current;
        if (audio) {
          audio.src = url;
          audio.currentTime = detection.start;
        }
      })
      .catch((caught: unknown) => {
        if (loadToken.current !== token) return;
        URL.revokeObjectURL(url);
        setProgress(null);
        setError(caught instanceof Error ? caught.message : "Couldn’t read that recording.");
      });
  }, [settings.serviceTime, settings.speaker, settings.series, settings.status]);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDrop = (event: DragEvent) => {
      if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFromFile(file);
    };
    const onLeave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setDragging(false);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragleave", onLeave);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragleave", onLeave);
    };
  }, [loadFromFile]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (!loaded) return;
      if (event.code === "Space") {
        event.preventDefault();
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play();
        else audio.pause();
      } else if (event.key === "i" || event.key === "I") {
        setStart(Math.max(0, Math.min(now, endRef.current - 0.5)));
      } else if (event.key === "o" || event.key === "O") {
        setEnd(Math.max(startRef.current + 0.5, Math.min(loaded.analysis.duration, now)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, now]);

  const trimKey = `${start.toFixed(2)}|${end.toFixed(2)}`;
  const prepKey = `${trimKey}|${clean.bitrate}|${clean.cutRumble}|${clean.tightenQuiet}|${clean.normalize}`;
  const mp3Ready = Boolean(mp3 && mp3.key === prepKey);
  const selection = Math.max(0, end - start);

  async function ensureMp3(): Promise<{ blob: Blob; filename: string }> {
    if (!loaded || !sourceRef.current) throw new Error("Drop a recording first.");
    if (mp3 && mp3.key === prepKey) return mp3;
    const bytes = await encodeSermonMp3(sourceRef.current, loaded.analysis.info, start, end, clean, (ratio, label) => {
      setProgress({ ratio, label });
    });
    const filename = sermonFileName(meta.speaker, meta.date);
    const blob = bytesToBlob(bytes, "audio/mpeg");
    const next = { blob, key: prepKey, filename };
    setMp3(next);
    return next;
  }

  async function onPrepare() {
    setError("");
    try {
      await ensureMp3();
      setProgress(null);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "Couldn’t encode the MP3.");
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function onDownload() {
    setError("");
    try {
      const ready = await ensureMp3();
      setProgress(null);
      downloadBlob(ready.blob, ready.filename);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "Couldn’t prepare the download.");
    }
  }

  async function onTranscribe() {
    if (!loaded || !sourceRef.current) return;
    setError("");
    setPublished(null);
    const snapshot = trimKey;
    const chunks = planChunks(start, end, loaded.analysis.features);
    if (chunks.length > 20) {
      setError("That selection is over about 90 minutes. Trim it a bit before transcribing.");
      return;
    }
    const parts: string[] = [];
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (!chunk) continue;
        setProgress({
          ratio: index / chunks.length,
          label: `Transcribing ${index + 1} of ${chunks.length}`,
        });
        const bytes = await encodeSermonMp3(
          sourceRef.current,
          loaded.analysis.info,
          chunk.start,
          chunk.end,
          { ...clean, bitrate: 40 },
          (ratio) => {
            const overall = (index + ratio * 0.65) / chunks.length;
            setProgress({ ratio: overall, label: `Preparing audio ${index + 1} of ${chunks.length}` });
          },
        );
        const audioBase64 = bytesToBase64(bytes);
        if (audioBase64.length > 3_600_000) throw new Error("A transcription piece came out too large. Try a shorter trim.");
        setProgress({
          ratio: (index + 0.7) / chunks.length,
          label: `Transcribing ${index + 1} of ${chunks.length}`,
        });
        const result = await transcribeAudio({
          data: {
            audioBase64,
            mime: "audio/mpeg",
            keyterms: sermonKeyterms(meta.speaker, meta.scripture),
          },
        });
        if (!result.ok) throw new Error(result.error);
        const text = result.words.length ? wordsToTranscript(result.words) : result.text;
        if (text.trim()) parts.push(text.trim());
      }
      setMeta((current) => ({ ...current, transcript: parts.join("\n\n") }));
      setTranscriptKey(snapshot);
      setProgress(null);
    } catch (caught) {
      setProgress(null);
      if (parts.length) {
        setMeta((current) => ({ ...current, transcript: parts.join("\n\n") }));
        setTranscriptKey(snapshot);
      }
      setError(caught instanceof Error ? caught.message : "Transcription failed.");
    }
  }

  async function onSuggest() {
    setError("");
    setProgress({ ratio: 0.4, label: "Suggesting a title" });
    const result = await suggestSermon({
      data: { transcript: clipForSuggestion(meta.transcript), speaker: meta.speaker },
    });
    setProgress(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMeta((current) => ({
      ...current,
      title: result.title,
      scripture: result.scripture,
      summary: result.summary,
    }));
  }

  async function onTestConnection() {
    setConnectionNote("");
    setError("");
    try {
      const result = await testConnection(settings);
      setConnectionNote(`Connected as ${result.name}.`);
    } catch (caught) {
      setConnectionNote("");
      setError(caught instanceof Error ? caught.message : "Couldn’t sign in to WordPress.");
    }
  }

  async function onPost() {
    setError("");
    if (!meta.title.trim()) {
      setError("Add a title before posting. Suggest one from the transcript, or type the preacher’s title.");
      document.getElementById("sermon-title")?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date) || !/^\d{2}:\d{2}$/.test(meta.time)) {
      setError("Set the service date and time.");
      return;
    }
    try {
      setProgress({ ratio: 0.05, label: "Preparing the MP3" });
      const ready = await ensureMp3();
      const filename = sermonFileName(meta.speaker, meta.date);
      setProgress({ ratio: 0.45, label: "Uploading audio" });
      const media = await uploadMedia(settings, ready.blob, filename, (ratio) => {
        setProgress({ ratio: 0.45 + ratio * 0.4, label: "Uploading audio" });
      });
      setProgress({ ratio: 0.9, label: meta.status === "publish" ? "Publishing the sermon" : "Saving the draft" });
      const created = await createSermon(settings, {
        title: meta.title,
        status: meta.status,
        date: `${meta.date}T${meta.time}:00`,
        summary: meta.summary,
        speaker: meta.speaker,
        scripture: meta.scripture,
        series: meta.series,
        audioUrl: media.source_url,
        transcript: meta.transcript,
      });
      setPublished({ ...created, admin: adminEditUrl(settings.siteUrl, created.id) });
      setSettings((current) => ({
        ...current,
        speaker: meta.speaker,
        series: meta.series,
        serviceTime: meta.time,
        status: meta.status,
      }));
      setProgress(null);
    } catch (caught) {
      setProgress(null);
      setError(caught instanceof Error ? caught.message : "Couldn’t post the sermon.");
      document.getElementById("connection")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function commitStart() {
    const parsed = parseTime(startText);
    if (parsed === null || !loaded) {
      setStartText(formatTime(start));
      return;
    }
    setStart(Math.max(0, Math.min(parsed, end - 0.5)));
  }

  function commitEnd() {
    const parsed = parseTime(endText);
    if (parsed === null || !loaded) {
      setEndText(formatTime(end));
      return;
    }
    setEnd(Math.max(start + 0.5, Math.min(loaded.analysis.duration, parsed)));
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (stopAtOut && (audio.currentTime < start || audio.currentTime >= end - 0.05)) {
      audio.currentTime = start;
    }
    await audio.play();
  }

  async function previewTrim() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = start;
    await audio.play();
  }

  const info = loaded?.analysis.info;
  const staleTranscript = Boolean(meta.transcript && transcriptKey && transcriptKey !== trimKey);

  return (
    <div className={`min-h-screen bg-bg text-ink ${dragging ? "ring-2 ring-inset ring-gold" : ""}`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {logoOk && (
              <img
                src="https://citizenschur.ch/wp-content/uploads/2026/07/cropped-Citizens_Logo_vert_gold_cutout-1-192x192.png"
                alt=""
                className="h-12 w-12 object-contain"
                onError={() => setLogoOk(false)}
              />
            )}
            <div>
              <p className="text-xs font-medium tracking-widest text-gold-deep uppercase">Citizens Church</p>
              <h1 className="font-display text-3xl leading-none text-ink sm:text-4xl">Message Desk</h1>
            </div>
          </div>
          <a
            href="https://citizenschur.ch/messages/"
            className="mt-1 text-sm text-gold-deep underline-offset-4 hover:underline"
          >
            On the site
          </a>
        </header>

        <p className="max-w-2xl text-pretty text-muted">
          Drop the Sunday WAV. Message Desk guesses where the sermon starts and ends, cleans a mono MP3, transcribes it, and posts a draft to citizenschur.ch.
        </p>

        {error && (
          <p className="rounded-lg border border-danger/30 bg-surface px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {!loaded && (
          <section
            className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-gold bg-surface px-5 py-10 sm:px-8"
          >
            <Upload className="size-6 text-gold-deep" aria-hidden="true" />
            <div>
              <h2 className="font-display text-2xl text-ink">Drop the board recording</h2>
              <p className="mt-1 max-w-xl text-sm text-pretty text-muted">
                WAV from the mixer, welcome through the last song. The file stays in this browser until you post it. An hour-long recording is fine.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
                Choose WAV
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const file = new File([bytesToBlob(makeSampleService(), "audio/wav")], "sample-service.wav", {
                    type: "audio/wav",
                  });
                  loadFromFile(file);
                }}
              >
                Load a sample service
              </button>
            </div>
          </section>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".wav,.wave,audio/wav,audio/x-wav,audio/wave"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) loadFromFile(file);
          }}
        />

        {progress && (
          <div className="space-y-2">
            <p className="text-sm text-muted">{progress.label}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div className="h-full bg-gold transition-[width] duration-200" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
          </div>
        )}

        {loaded && info && (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
              <div>
                <p className="font-medium text-ink">{loaded.name}</p>
                <p className="text-sm text-muted tabular-nums">
                  {(info.sampleRate / 1000).toFixed(1)} kHz · {info.channels === 1 ? "mono" : `${info.channels} channels`} · {info.bits}-bit · {formatDuration(loaded.analysis.duration)}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
                Replace
              </button>
            </section>

            <section className="rounded-lg border border-line bg-gold-soft/50 px-4 py-3">
              <p className="text-xs font-medium tracking-widest text-gold-deep uppercase">{confidenceLabel(loaded.detection.confidence)}</p>
              <p className="mt-1 text-pretty text-ink">{loaded.detection.reason}</p>
              <button
                type="button"
                className="btn-quiet mt-2"
                onClick={() => {
                  setStart(loaded.detection.start);
                  setEnd(loaded.detection.end);
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset to guess
              </button>
            </section>

            <section className="space-y-4">
              <Waveform
                duration={loaded.analysis.duration}
                peaks={loaded.analysis.peaks}
                peaksPerSec={loaded.analysis.peaksPerSec}
                labels={loaded.detection.labels}
                start={start}
                end={end}
                current={now}
                onChangeStart={setStart}
                onChangeEnd={setEnd}
                onSeek={(time) => {
                  setNow(time);
                  if (audioRef.current) audioRef.current.currentTime = time;
                }}
              />

              <div className="flex flex-wrap items-end gap-3">
                <button type="button" className="btn-primary" onClick={() => void togglePlay()}>
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => void previewTrim()}>
                  Preview trim
                </button>
                <p className="pb-2 text-sm text-muted tabular-nums">{formatTime(now, false)} / {formatTime(loaded.analysis.duration, false)}</p>
                <label className="mb-2 inline-flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={stopAtOut} onChange={(event) => setStopAtOut(event.target.checked)} />
                  Stop at out point
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">In point</span>
                  <input
                    className={fieldClass}
                    value={startText}
                    inputMode="decimal"
                    onFocus={() => {
                      startFocused.current = true;
                    }}
                    onBlur={() => {
                      startFocused.current = false;
                      commitStart();
                    }}
                    onChange={(event) => setStartText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Out point</span>
                  <input
                    className={fieldClass}
                    value={endText}
                    inputMode="decimal"
                    onFocus={() => {
                      endFocused.current = true;
                    }}
                    onBlur={() => {
                      endFocused.current = false;
                      commitEnd();
                    }}
                    onChange={(event) => setEndText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-quiet" onClick={() => setStart((value) => Math.max(0, value - 1))}>In −1s</button>
                <button type="button" className="btn-quiet" onClick={() => setStart((value) => Math.max(0, value - 0.1))}>In −0.1s</button>
                <button type="button" className="btn-quiet" onClick={() => setStart((value) => Math.min(end - 0.5, value + 0.1))}>In +0.1s</button>
                <button type="button" className="btn-quiet" onClick={() => setEnd((value) => Math.max(start + 0.5, value - 1))}>Out −1s</button>
                <button type="button" className="btn-quiet" onClick={() => setEnd((value) => Math.min(loaded.analysis.duration, value + 0.1))}>Out +0.1s</button>
                <button type="button" className="btn-quiet" onClick={() => setEnd((value) => Math.min(loaded.analysis.duration, value + 1))}>Out +1s</button>
              </div>
              <p className="text-sm text-muted">
                {formatDuration(selection)} selected. Press I or O to set a point at the playhead. Space plays. Preview is the raw recording — the MP3 is the cleaned one.
              </p>
            </section>

            <section className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1.2fr_1fr]">
              <div>
                <h2 className="font-display text-xl">Clean export</h2>
                <p className="mt-1 text-sm text-pretty text-muted">
                  Mono, rumble cut, pauses eased down, voice leveled. Not a studio master — enough that the room recording doesn’t boom or whisper.
                </p>
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={clean.cutRumble}
                      onChange={(event) => setClean((current) => ({ ...current, cutRumble: event.target.checked }))}
                    />
                    Cut rumble under 80 Hz
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={clean.tightenQuiet}
                      onChange={(event) => setClean((current) => ({ ...current, tightenQuiet: event.target.checked }))}
                    />
                    Ease room tone in the pauses
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={clean.normalize}
                      onChange={(event) => setClean((current) => ({ ...current, normalize: event.target.checked }))}
                    />
                    Level the voice
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-muted">MP3 quality</span>
                  <select
                    className={fieldClass}
                    value={clean.bitrate}
                    onChange={(event) => setClean((current) => ({ ...current, bitrate: Number(event.target.value) }))}
                  >
                    <option value={64}>64 kbps · smaller</option>
                    <option value={96}>96 kbps · spoken word</option>
                    <option value={128}>128 kbps · larger</option>
                  </select>
                </label>
                <p className="text-sm text-muted tabular-nums">
                  About {formatBytes((clean.bitrate * 1000 * selection) / 8)} · {sermonFileName(meta.speaker, meta.date)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" disabled={Boolean(progress)} onClick={() => void onPrepare()}>
                    {mp3Ready ? "MP3 ready" : "Prepare MP3"}
                  </button>
                  <button type="button" className="btn-secondary" disabled={Boolean(progress)} onClick={() => void onDownload()}>
                    <Download className="size-4" />
                    Download
                  </button>
                </div>
                {mp3Ready && mp3 && <p className="text-sm text-gold-deep">{formatBytes(mp3.blob.size)} ready on this page.</p>}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl">Sermon</h2>
                  <p className="mt-1 text-sm text-muted">
                    {import.meta.env.VITE_GITHUB_PAGES === "1"
                      ? "GitHub Pages has no server, so Transcribe and Suggest stay off here. Trim, the MP3, download, and posting to the church site still work."
                      : `Transcription is ${formatCost(selection)} at 10¢ an hour on your xAI account. A full sermon can take a few minutes — leave the tab open.`}
                  </p>
                </div>
                <button type="button" className="btn-primary" disabled={Boolean(progress)} onClick={() => void onTranscribe()}>
                  Transcribe
                </button>
              </div>
              {staleTranscript && (
                <p className="text-sm text-gold-deep">The trim moved after this transcript was written. Transcribe again if the words should match the new cut.</p>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Transcript</span>
                <textarea
                  className={`${fieldClass} min-h-56 font-display text-lg leading-relaxed`}
                  value={meta.transcript}
                  onChange={(event) => setMeta((current) => ({ ...current, transcript: event.target.value }))}
                  placeholder="The transcript lands here. You can edit it before it goes on the site."
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={meta.transcript.trim().length < 40 || Boolean(progress)}
                  onClick={() => void onSuggest()}
                >
                  <Sparkles className="size-4" />
                  Suggest title and passage
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={!meta.transcript.trim()}
                  onClick={() => {
                    const blob = new Blob([meta.transcript], { type: "text/plain" });
                    downloadBlob(blob, sermonFileName(meta.speaker, meta.date).replace(/\.mp3$/, ".txt"));
                  }}
                >
                  Download text
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={!meta.transcript.trim()}
                  onClick={() => void navigator.clipboard.writeText(meta.transcript)}
                >
                  Copy
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">Title</span>
                  <input
                    id="sermon-title"
                    className={fieldClass}
                    value={meta.title}
                    maxLength={140}
                    onChange={(event) => setMeta((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Killing the Root of Bitterness"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Speaker</span>
                  <input
                    className={fieldClass}
                    value={meta.speaker}
                    onChange={(event) => setMeta((current) => ({ ...current, speaker: event.target.value }))}
                    placeholder="Conor Eastman"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Scripture</span>
                  <input
                    className={fieldClass}
                    value={meta.scripture}
                    onChange={(event) => setMeta((current) => ({ ...current, scripture: event.target.value }))}
                    placeholder="Ephesians 4:31–32"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Series</span>
                  <input
                    className={fieldClass}
                    value={meta.series}
                    onChange={(event) => setMeta((current) => ({ ...current, series: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Service date</span>
                  <input
                    type="date"
                    className={fieldClass}
                    value={meta.date}
                    onChange={(event) => setMeta((current) => ({ ...current, date: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Service time</span>
                  <input
                    type="time"
                    className={fieldClass}
                    value={meta.time}
                    onChange={(event) => setMeta((current) => ({ ...current, time: event.target.value }))}
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">Short summary</span>
                  <textarea
                    className={`${fieldClass} min-h-20`}
                    value={meta.summary}
                    onChange={(event) => setMeta((current) => ({ ...current, summary: event.target.value }))}
                  />
                </label>
              </div>
            </section>

            <section id="connection" className="space-y-4 rounded-lg border border-line bg-surface p-4">
              <div>
                <h2 className="font-display text-xl">Post to the site</h2>
                <p className="mt-1 text-sm text-pretty text-muted">
                  Uses a WordPress application password, stored only in this browser. Users → Profile → Application Passwords. Don’t use this on a shared computer. Drafts stay off the public messages page until you publish them in WordPress.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">Site</span>
                  <input
                    className={fieldClass}
                    value={settings.siteUrl}
                    onChange={(event) => setSettings((current) => ({ ...current, siteUrl: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Username</span>
                  <input
                    className={fieldClass}
                    autoComplete="username"
                    value={settings.username}
                    onChange={(event) => setSettings((current) => ({ ...current, username: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Application password</span>
                  <input
                    type="password"
                    className={fieldClass}
                    autoComplete="current-password"
                    value={settings.appPassword}
                    onChange={(event) => setSettings((current) => ({ ...current, appPassword: event.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">When posting</span>
                  <select
                    className={fieldClass}
                    value={meta.status}
                    onChange={(event) =>
                      setMeta((current) => ({ ...current, status: event.target.value === "publish" ? "publish" : "draft" }))
                    }
                  >
                    <option value="draft">Save as draft</option>
                    <option value="publish">Publish now</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary" disabled={Boolean(progress)} onClick={() => void onTestConnection()}>
                  Test connection
                </button>
                <button type="button" className="btn-primary" disabled={Boolean(progress) || !loaded} onClick={() => void onPost()}>
                  {meta.status === "publish" ? "Publish sermon" : "Post draft"}
                </button>
                {connectionNote && <p className="text-sm text-gold-deep">{connectionNote}</p>}
              </div>
              {published && (
                <div className="rounded-lg border border-line bg-gold-soft/60 px-4 py-3 text-sm">
                  <p className="inline-flex items-center gap-2 font-medium text-ink">
                    <Check className="size-4 text-gold-deep" />
                    {published.status === "publish" ? "Sermon is live." : "Draft saved on the site."}
                  </p>
                  {!published.audioSaved && (
                    <p className="mt-1 text-danger">The post exists, but the audio field didn’t stick. Open it in WordPress and check the sermon audio.</p>
                  )}
                  <p className="mt-2 flex flex-wrap gap-4">
                    <a className="text-gold-deep underline-offset-4 hover:underline" href={published.link}>
                      View message
                    </a>
                    <a className="text-gold-deep underline-offset-4 hover:underline" href={published.admin}>
                      Edit in WordPress
                    </a>
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        <section>
          <h2 className="font-display text-xl">Recent messages</h2>
          {recent === null ? (
            <p className="mt-2 text-sm text-muted">Loading messages…</p>
          ) : recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing public yet, or the site didn’t answer.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {recent.map((sermon) => (
                <li key={sermon.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <a href={sermon.link} className="font-medium text-ink underline-offset-4 hover:underline">
                    {sermon.title}
                  </a>
                  <span className="text-sm text-muted">
                    {sermon.date.slice(0, 10)}
                    {sermon.speaker ? ` · ${sermon.speaker}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <audio
        ref={audioRef}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          setNow(audio.currentTime);
          if (stopRef.current && audio.currentTime >= endRef.current - 0.02) audio.pause();
        }}
      />
    </div>
  );
}
