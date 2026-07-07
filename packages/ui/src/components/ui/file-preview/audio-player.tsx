"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  useAudio,
  usePlaybackProgress,
  usePlaybackState,
  useVarispeed,
  useVolume,
  useAudioActions,
  useFrequencyData,
} from "@si/audio/react";
import { Waveform } from "../waveform";
import { SpectrumAnalyzer } from "../spectrum-analyzer";
import { Button } from "../button";
import { Dial } from "../dial";
import { Fader } from "../fader";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";
import { Play, Pause, Loader2, Volume2, VolumeX, Volume1, Download } from "lucide-react";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface AudioPlayerProps {
  url: string;
  fileName: string;
  waveformData: string | null;
}

export function AudioPlayer({ url, fileName, waveformData }: AudioPlayerProps) {
  const { initializeEngine, loadPlayable, isLoading } = useAudio();
  const { currentTime, duration, progress } = usePlaybackProgress();
  const { isPlaying } = usePlaybackState();
  const { playbackRate } = useVarispeed();
  const { volume, muted } = useVolume();
  const actions = useAudioActions();
  const { getFrequencyData } = useFrequencyData();

  const [openPopup, setOpenPopup] = useState<"speed" | "volume" | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const initRef = useRef(false);

  // Effective wall-clock duration/position at the current playback rate — the
  // cursor's position in the waveform is `currentTime/duration`, which is
  // rate-invariant, so changing varispeed updates the numeric display without
  // moving the cursor on the waveform.
  const safeRate = playbackRate > 0 ? playbackRate : 1;
  const effectiveCurrentTime = currentTime / safeRate;
  const effectiveDuration = duration / safeRate;

  // Debounce the "altered speed" boolean so scrubbing the dial through 1.00x
  // doesn't cause the extra download button to flicker in/out. The button
  // only appears/disappears after the rate has been stable for ~250ms.
  const isAlteredSpeed = Math.abs(playbackRate - 1) > 0.009;
  const [showExport, setShowExport] = useState(isAlteredSpeed);
  useEffect(() => {
    const t = setTimeout(() => setShowExport(isAlteredSpeed), 250);
    return () => clearTimeout(t);
  }, [isAlteredSpeed]);

  // Canvas fillStyle can't resolve CSS custom properties (no element context),
  // so we read `--color-pistil-hsl` off :root and hand Waveform fully-formed
  // hsl() strings. The MutationObserver picks up theme class flips.
  const [waveformColors, setWaveformColors] = useState<{
    played: string;
    unplayed: string;
  } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => {
      const tuple = getComputedStyle(document.documentElement)
        .getPropertyValue("--color-pistil-hsl")
        .trim();
      if (!tuple) return;
      setWaveformColors({
        played: `hsl(${tuple})`,
        unplayed: `hsl(${tuple} / 0.35)`,
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    initializeEngine()
      .then(() => loadPlayable({ id: url, url, title: fileName }))
      .catch(() => {});
  }, [initializeEngine, loadPlayable, url, fileName]);

  const handlePlayPause = useCallback(async () => {
    await actions.toggle();
  }, [actions]);

  const handleSeek = useCallback(
    (newProgress: number) => {
      if (duration > 0) {
        actions.seek(newProgress * duration);
      }
    },
    [actions, duration],
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const blob = await actions.exportAudio("wav");
      const ext = fileName.replace(/\.[^.]+$/, "");
      const exportName = `${ext}_${playbackRate.toFixed(2)}x.wav`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = exportName;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }, [actions, fileName, playbackRate]);

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex flex-col gap-0 overflow-hidden rounded-lg border">
      <div className="h-16 bg-muted/30">
        {waveformData ? (
          <Waveform
            data={waveformData}
            progress={progress}
            durationMs={effectiveDuration * 1000}
            onSeek={handleSeek}
            height={64}
            showTopHalfOnly
            className="border-0"
            playedColor={waveformColors?.played}
            unplayedColor={waveformColors?.unplayed}
          />
        ) : isPlaying ? (
          <SpectrumAnalyzer
            getFrequencyData={getFrequencyData}
            height={64}
            barCount={48}
            mirror={false}
            className="border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-muted-foreground text-xs">
              {isLoading ? "Generating waveform…" : "Audio preview"}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={handlePlayPause} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="size-4" />
          ) : (
            <Play className="size-4 ml-0.5" />
          )}
        </Button>

        <span className="text-muted-foreground min-w-[5ch] font-mono text-xs tabular-nums">
          {formatTime(effectiveCurrentTime)}
        </span>

        {!waveformData && (
          <div
            className="relative h-1 flex-1 cursor-pointer rounded-full bg-muted"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              handleSeek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {waveformData && <div className="flex-1" />}

        <span className="text-muted-foreground min-w-[5ch] text-right font-mono text-xs tabular-nums">
          {formatTime(effectiveDuration)}
        </span>

        <Popover
          open={openPopup === "speed"}
          onOpenChange={(o) => setOpenPopup(o ? "speed" : null)}
        >
          <PopoverTrigger
            render={
              <Button
                variant={openPopup === "speed" ? "default" : "ghost"}
                size="sm"
                className="font-mono text-xs"
              >
                {playbackRate.toFixed(2)}x
              </Button>
            }
          />
          <PopoverContent side="top" align="end" className="w-56 p-3">
            <Dial
              value={playbackRate}
              onChange={actions.setPlaybackRate}
              min={0.5}
              max={2}
              step={0.01}
              notches={16}
              label="Speed"
              formatValue={(v) => `${v.toFixed(2)}x`}
            />
          </PopoverContent>
        </Popover>

        <Popover
          open={openPopup === "volume"}
          onOpenChange={(o) => setOpenPopup(o ? "volume" : null)}
        >
          <PopoverTrigger
            render={
              <Button variant={openPopup === "volume" ? "default" : "ghost"} size="icon-sm">
                <VolumeIcon className="size-4" />
              </Button>
            }
          />
          <PopoverContent side="top" align="end" className="w-auto min-w-0 p-3">
            <Fader
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(v) => {
                if (muted) actions.setMuted(false);
                actions.setVolume(v / 100);
              }}
              min={0}
              max={100}
              step={1}
              notches={11}
              label="Vol"
              formatValue={(v) => `${v}%`}
              className="h-32"
            />
          </PopoverContent>
        </Popover>

        <AnimatePresence initial={false}>
          {showExport && (
            <motion.div
              key="export"
              layout
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center overflow-hidden"
            >
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 whitespace-nowrap text-xs"
                onClick={handleExport}
                disabled={isExporting || isLoading}
              >
                {isExporting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                {playbackRate.toFixed(2)}x
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="border-t px-3 py-1.5">
        <span className="text-muted-foreground truncate text-xs">{fileName}</span>
      </div>
    </div>
  );
}
