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
