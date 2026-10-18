import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { RegionKind } from "@/lib/audio/detect";
import { formatTime } from "@/lib/format";

type Props = {
  duration: number;
  peaks: Float32Array;
  peaksPerSec: number;
  labels: RegionKind[];
  start: number;
  end: number;
  current: number;
  onChangeStart: (time: number) => void;
  onChangeEnd: (time: number) => void;
  onSeek: (time: number) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function Waveform({
  duration,
  peaks,
  peaksPerSec,
  labels,
  start,
  end,
  current,
  onChangeStart,
  onChangeEnd,
  onSeek,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<[number, number]>([0, Math.max(duration, 1)]);
  const viewRef = useRef(view);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const drag = useRef<"start" | "end" | "seek" | null>(null);
  viewRef.current = view;
  startRef.current = start;
  endRef.current = end;

  useEffect(() => {
    setView([0, Math.max(duration, 1)]);
  }, [duration]);

  const path = useMemo(() => {
    const [viewStart, viewEnd] = view;
    const span = Math.max(0.001, viewEnd - viewStart);
    const columns = 720;
    let description = "";
    for (let column = 0; column < columns; column += 1) {
      const t0 = viewStart + (span * column) / columns;
      const t1 = viewStart + (span * (column + 1)) / columns;
      const from = Math.max(0, Math.floor(t0 * peaksPerSec));
      const to = Math.min(peaks.length / 2, Math.max(from + 1, Math.ceil(t1 * peaksPerSec)));
      let min = 1;
      let max = -1;
      for (let index = from; index < to; index += 1) {
        const low = peaks[index * 2] ?? 0;
        const high = peaks[index * 2 + 1] ?? 0;
        if (low < min) min = low;
        if (high > max) max = high;
      }
      if (min > max) {
        min = 0;
        max = 0;
      }
      let y1 = 50 - clamp(max, -1, 1) * 44;
      let y2 = 50 - clamp(min, -1, 1) * 44;
      if (y2 - y1 < 0.7) {
        const mid = (y1 + y2) / 2;
        y1 = mid - 0.35;
        y2 = mid + 0.35;
      }
      const x = ((column + 0.5) / columns) * 1000;
      description += `M${x.toFixed(2)} ${y1.toFixed(2)}L${x.toFixed(2)} ${y2.toFixed(2)}`;
    }
    return description;
  }, [peaks, peaksPerSec, view]);

  const bands = useMemo(() => {
    const runs: Array<{ kind: RegionKind; start: number; end: number }> = [];
    labels.forEach((kind, index) => {
      const previous = runs[runs.length - 1];
      if (previous && previous.kind === kind) previous.end = index + 1;
      else runs.push({ kind, start: index, end: index + 1 });
    });
    return runs;
  }, [labels]);

  function xOf(time: number): number {
    const [viewStart, viewEnd] = view;
    return ((time - viewStart) / Math.max(0.001, viewEnd - viewStart)) * 1000;
  }

  function timeAt(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    const [viewStart, viewEnd] = viewRef.current;
    if (!rect || rect.width === 0) return viewStart;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return viewStart + ratio * (viewEnd - viewStart);
  }

  function applyDrag(mode: "start" | "end" | "seek", time: number) {
    if (mode === "seek") {
      onSeek(clamp(time, 0, duration));
      return;
    }
    if (mode === "start") onChangeStart(clamp(time, 0, endRef.current - 0.5));
    else onChangeEnd(clamp(time, startRef.current + 0.5, duration));
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    const time = timeAt(event.clientX);
    const rect = svgRef.current?.getBoundingClientRect();
    const span = Math.max(0.001, viewRef.current[1] - viewRef.current[0]);
    const pxPerSec = rect && rect.width > 0 ? rect.width / span : 1;
    const startPx = Math.abs(time - startRef.current) * pxPerSec;
    const endPx = Math.abs(time - endRef.current) * pxPerSec;
    let mode: "start" | "end" | "seek" = "seek";
    if (startPx < 18 || endPx < 18) mode = startPx <= endPx ? "start" : "end";
    drag.current = mode;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyDrag(mode, time);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    applyDrag(drag.current, timeAt(event.clientX));
  }

  function focusOn(time: number) {
    const half = Math.min(duration / 2, 45);
    let from = time - half;
    let to = time + half;
    if (from < 0) {
      to -= from;
      from = 0;
    }
    if (to > duration) {
      from -= to - duration;
      to = duration;
    }
    setView([Math.max(0, from), Math.max(half, to)]);
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => view[0] + (view[1] - view[0]) * ratio);
  const trimStart = xOf(clamp(start, view[0], view[1]));
  const trimEnd = xOf(clamp(end, view[0], view[1]));
  const playhead = xOf(current);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => setView([0, Math.max(duration, 1)])}>
          Whole service
        </button>
        <button type="button" className="btn-quiet" onClick={() => focusOn(start)}>
          Zoom in point
        </button>
        <button type="button" className="btn-quiet" onClick={() => focusOn(end)}>
          Zoom out point
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 1000 100"
        className="h-36 w-full touch-none rounded-lg border border-line bg-surface select-none sm:h-44"
        role="img"
        aria-label="Waveform of the service. Drag the gold handles to set the sermon start and end."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {bands.map((band) => {
          const x = xOf(Math.max(band.start, view[0]));
          const width = xOf(Math.min(band.end, view[1])) - x;
          if (width <= 0 || band.kind === "silence") return null;
          return (
            <rect
              key={`${band.kind}-${band.start}`}
              x={x}
              y={0}
              width={width}
              height={100}
              fill={band.kind === "speech" ? "var(--color-speech)" : "var(--color-music)"}
            />
          );
        })}
        {trimEnd > trimStart && (
          <rect x={trimStart} y={0} width={trimEnd - trimStart} height={100} fill="var(--color-gold)" opacity={0.18} />
        )}
        <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        <line
          x1={trimStart}
          x2={trimStart}
          y1={0}
          y2={100}
          stroke="var(--color-gold-deep)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <rect x={trimStart - 7} y={0} width={14} height={16} rx={2} fill="var(--color-gold-deep)" />
        <line
          x1={trimEnd}
          x2={trimEnd}
          y1={0}
          y2={100}
          stroke="var(--color-gold-deep)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <rect x={trimEnd - 7} y={84} width={14} height={16} rx={2} fill="var(--color-gold-deep)" />
        {current >= view[0] && current <= view[1] && (
          <line
            x1={playhead}
            x2={playhead}
            y1={0}
            y2={100}
            stroke="var(--color-ink)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted tabular-nums">
        {ticks.map((tick) => (
          <span key={tick}>{formatTime(tick, false)}</span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-speech" /> Speaking
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-music" /> Music or crowd
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-gold" /> Trim
        </span>
      </p>
    </div>
  );
}
