"use client";

import { useRef, useEffect, useCallback, useMemo, useState, type MouseEvent } from "react";
import { generateWaveformFromUrl } from "@si/audio/waveform";
import { cn } from "@si/ui/lib/utils";

// CSS custom properties resolve to a fully-formed color (e.g., "hsl(210 60% 62%)"
// or "rgb(106, 158, 209)") via getComputedStyle. Wrapping that again in hsl(...)
// produces "hsl(hsl(...))" which is invalid and silently falls back to black on
// canvas. So we treat the resolved value as authoritative and only synthesise an
// hsl() wrapper around the bare HSL-component fallback string.
function resolveThemeColor(varName: string, fallback: string, alpha?: number): string {
  const wrapBare = (raw: string) => (alpha != null ? `hsl(${raw} / ${alpha})` : `hsl(${raw})`);
  if (typeof window === "undefined") return wrapBare(fallback);
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!value) return wrapBare(fallback);
  if (alpha == null) return value;
  // Inject alpha into existing hsl()/rgb() form. If parsing fails, return the
  // value uncomposited — opacity loss is preferable to an invalid color.
  const m = value.match(/^(hsla?|rgba?)\(([^)]*)\)$/i);
  if (!m) return value;
  const fn = m[1]!.toLowerCase();
  const inner = m[2]!.replace(/\/.*$/, "").trim();
  const base = fn.startsWith("hsl") ? "hsl" : "rgb";
  return `${base}(${inner} / ${alpha})`;
}

export type WaveformDensity = "sparse" | "med" | "dense";

export interface WaveformComment {
  /** Position 0..1 along the track */
  t: number;
  /** Optional override (defaults to pistil). HSL components or full color. */
  color?: string;
}

export interface WaveformProps {
  /** JSON array of peak values (0-1) — accepts string or pre-parsed array */
  data: string | number[] | null | undefined;
  /** Current playback position (0-1) */
  progress?: number;
  /** Buffered position (0-1). Bars past this point render at reduced alpha. */
  buffered?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Called when user clicks/seeks on waveform */
  onSeek?: (progress: number) => void;
  /** A-B loop start (0-1) */
  loopStart?: number | null;
  /** A-B loop end (0-1) */
  loopEnd?: number | null;
  /** Height in pixels */
  height?: number;
  /** Override target bar count (downsamples peaks) */
  bars?: number;
  /** Bar packing — 'med' (default, 1px gap) preserves existing look. */
  density?: WaveformDensity;
  /** Color for played portion */
  playedColor?: string;
  /** Color for unplayed portion */
  unplayedColor?: string;
  /** Color for loop region */
  loopColor?: string;
  /** Comment markers (vertical ticks). */
  comments?: WaveformComment[];
  /** Render a 1px line at the vertical center. */
  centerline?: boolean;
  /** CSS box-shadow glow on the playhead overlay. */
  playheadGlow?: boolean;
  /** When `data` is empty, fetch + decode this URL client-side and render the
   *  computed peaks. Cheap fallback for tracks the server didn't persist peaks for. */
  computeFromUrl?: string | null;
  /** Additional class names */
  className?: string;
  /** Whether the waveform is interactive */
  interactive?: boolean;
  /** Only show top half of waveform (bars grow upward from bottom) */
  showTopHalfOnly?: boolean;
}

export function Waveform({
  data,
  progress = 0,
  buffered = 1,
  durationMs = 0,
  onSeek,
  loopStart,
  loopEnd,
  height = 64,
  bars,
  density = "med",
  playedColor,
  unplayedColor,
  loopColor,
  comments,
  centerline = false,
  playheadGlow = false,
  computeFromUrl,
  className,
  interactive = true,
  showTopHalfOnly = false,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [computedPeaks, setComputedPeaks] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [resizeTick, setResizeTick] = useState(0);
  const fetchedUrlRef = useRef<string | null>(null);
  const lastSizeRef = useRef<{ w: number; h: number; dpr: number } | null>(null);

  // Resolve once per prop-override change. Theme switches require a remount —
  // acceptable trade-off vs. forcing a style recalc on every render of every
  // Waveform on the page (TrackRow renders one per row).
  const colors = useMemo(
    () => ({
      played: playedColor ?? resolveThemeColor("--color-primary", "210 60% 62%"),
      unplayed: unplayedColor ?? resolveThemeColor("--color-text-secondary", "45 8% 60%", 0.7),
      loop: loopColor ?? resolveThemeColor("--color-primary", "210 60% 62%", 0.18),
      comment: resolveThemeColor("--color-warning", "42 50% 58%"),
      tertiary: resolveThemeColor("--color-text-secondary", "45 8% 60%", 0.45),
    }),
    [playedColor, unplayedColor, loopColor],
  );

  const peaks = useMemo(() => {
    const raw = parsePeaks(data);
    if (raw.length > 0) return bars && bars > 0 ? resamplePeaks(raw, bars) : raw;
    const fallback = parsePeaks(computedPeaks);
    return bars && bars > 0 ? resamplePeaks(fallback, bars) : fallback;
  }, [data, computedPeaks, bars]);

  // Compute peaks client-side when no server-side peaks were provided.
  // Idempotent per (computeFromUrl): we only fetch once and cache locally.
  // Note: cleanup intentionally does NOT cancel — under StrictMode a synchronous
  // mount→unmount→mount pair would otherwise drop the in-flight fetch and the
  // ref-based guard would block the second mount from re-trying.
  useEffect(() => {
    if (!computeFromUrl) return;
    if (parsePeaks(data).length > 0) return;
    if (fetchedUrlRef.current === computeFromUrl) return;
    fetchedUrlRef.current = computeFromUrl;
    setComputing(true);
    generateWaveformFromUrl(computeFromUrl)
      .then((res) => {
        setComputedPeaks(res.waveformData);
      })
      .catch(() => {
        // Allow a retry next mount.
        if (fetchedUrlRef.current === computeFromUrl) fetchedUrlRef.current = null;
      })
      .finally(() => {
        setComputing(false);
      });
  }, [computeFromUrl, data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || peaks.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    // Skip the canvas-bitmap re-allocation when only the playhead / progress
    // changed. Resize wipes the bitmap and resets the transform, so we only
    // pay for it when dimensions actually shift.
    const last = lastSizeRef.current;
    if (!last || last.w !== width || last.h !== height || last.dpr !== dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
      lastSizeRef.current = { w: width, h: height, dpr };
    }

    ctx.clearRect(0, 0, width, height);

    if (loopStart != null && loopEnd != null && loopStart < loopEnd) {
      ctx.fillStyle = colors.loop;
      ctx.fillRect(loopStart * width, 0, (loopEnd - loopStart) * width, height);
    }

    const gapPx = density === "dense" ? 0 : density === "sparse" ? 2 : 1;
    const barWidth = width / peaks.length;
    const drawWidth = Math.max(1, barWidth - gapPx);
    const maxBarHeight = showTopHalfOnly ? height * 0.95 : height * 0.9;
    const centerY = height / 2;

    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const t = i / peaks.length;
      const isPlayed = t < progress;
      const inLoop = loopStart != null && loopEnd != null && t >= loopStart && t <= loopEnd;
      ctx.fillStyle =
        isPlayed || inLoop ? colors.played : t <= buffered ? colors.unplayed : colors.tertiary;

      if (showTopHalfOnly) {
        const barHeight = Math.max(2, peak * maxBarHeight);
        ctx.fillRect(x, height - barHeight, drawWidth, barHeight);
        return;
      }

      const barHeight = Math.max(2, peak * maxBarHeight);
      ctx.fillRect(x, centerY - barHeight / 2, drawWidth, barHeight);
    });

    if (progress > 0 && progress < 1 && !playheadGlow) {
      const playheadX = progress * width;
      ctx.strokeStyle = colors.played;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
    }

    if (loopStart != null) drawLoopMarker(ctx, loopStart * width, height, colors.loop);
    if (loopEnd != null) drawLoopMarker(ctx, loopEnd * width, height, colors.loop);
  }, [
    peaks,
    progress,
    buffered,
    loopStart,
    loopEnd,
    height,
    density,
    playheadGlow,
    colors,
    showTopHalfOnly,
    resizeTick,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      // Drop the cached size so the next render re-allocates + redraws.
      lastSizeRef.current = null;
      setResizeTick((t) => t + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !interactive) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newProgress = Math.max(0, Math.min(1, x / rect.width));
      onSeek(newProgress);
    },
    [onSeek, interactive],
  );

  if (peaks.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center border-2 border-foreground bg-muted",
          className,
        )}
        style={{ height }}
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {computing ? "Analyzing audio…" : "No waveform data"}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full border-2 border-foreground bg-surface-sunken",
        interactive && "cursor-pointer",
        className,
      )}
      style={{ height }}
      onClick={handleClick}
      role={interactive ? "slider" : undefined}
      aria-label={interactive ? "Audio progress" : undefined}
      aria-valuenow={interactive ? Math.round(progress * 100) : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 100 : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
      {centerline && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-px bg-border opacity-60"
        />
      )}
      {comments?.map((c, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 -bottom-1 w-px"
          style={{ left: `${c.t * 100}%`, background: c.color ?? colors.comment }}
        >
          <div
            className="absolute -left-[2px] -top-[3px]"
            style={{ width: 5, height: 5, background: c.color ?? colors.comment }}
          />
        </div>
      ))}
      {playheadGlow && progress > 0 && progress < 1 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 -bottom-1"
          style={{
            left: `${progress * 100}%`,
            width: 1.5,
            background: "var(--color-text)",
            boxShadow: "0 0 8px hsl(60 100% 95% / 0.6)",
          }}
        />
      )}
      {durationMs > 0 && (
        <div className="absolute bottom-1 right-2 text-xs font-mono text-white/50">
          {formatDuration(progress * durationMs)} / {formatDuration(durationMs)}
        </div>
      )}
    </div>
  );
}

function parsePeaks(data: string | number[] | null | undefined): number[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter((p): p is number => typeof p === "number" && p >= 0 && p <= 1);
  }
  try {
    const peaks = JSON.parse(data) as unknown;
    if (!Array.isArray(peaks)) return [];
    return peaks.filter((p): p is number => typeof p === "number" && p >= 0 && p <= 1);
  } catch {
    return [];
  }
}

function resamplePeaks(peaks: number[], target: number): number[] {
  if (peaks.length === 0 || peaks.length === target) return peaks;
  if (peaks.length > target) {
    // Bucket-average down.
    const out: number[] = [];
    const ratio = peaks.length / target;
    for (let i = 0; i < target; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let max = 0;
      for (let j = start; j < end && j < peaks.length; j++) {
        if (peaks[j]! > max) max = peaks[j]!;
      }
      out.push(max);
    }
    return out;
  }
  // Up-sample by nearest-neighbour. Cheap; rare path (we usually downsample).
  const out: number[] = Array.from({ length: target }, () => 0);
  for (let i = 0; i < target; i++) {
    out[i] = peaks[Math.floor((i / target) * peaks.length)]!;
  }
  return out;
}

function drawLoopMarker(ctx: CanvasRenderingContext2D, x: number, height: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
