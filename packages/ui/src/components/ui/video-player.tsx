"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Dial } from "./dial";
import { Fader } from "./fader";
import {
  Play,
  Pause,
  Loader2,
  Volume2,
  VolumeX,
  Volume1,
  Maximize2,
  Minimize2,
  Download,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@si/ui/lib/utils";

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0)
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface VideoPlayerProps {
  src: string;
  fileName?: string;
  className?: string;
  onEnded?: () => void;
  onDownload?: () => void;
}

export function VideoPlayer({ src, fileName, className, onEnded, onDownload }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // ── Video event listeners ──────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      setIsLoading(false);
    };
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onError = () => {
      setIsLoading(false);
      const err = video.error;
      if (err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setVideoError(
          "This video format isn't supported by your browser. Download it to play locally.",
        );
      } else {
        setVideoError("Failed to load video.");
      }
    };
    // Detect audio-only playback (video track can't decode, e.g. ProRes .mov)
    const onPlaying = () => {
      if (video.videoWidth === 0 && video.videoHeight === 0) {
        video.pause();
        setVideoError(
          "This video's codec isn't supported by your browser. The audio may work, but the video can't be displayed. Download it to play locally.",
        );
      }
    };
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onRateChange = () => setPlaybackRate(video.playbackRate);
    const onEnded_ = () => {
      setIsPlaying(false);
      setShowControls(true);
      onEnded?.();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("error", onError);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);
    video.addEventListener("ended", onEnded_);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("error", onError);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
      video.removeEventListener("ended", onEnded_);
    };
  }, [onEnded]);

  // ── Auto-hide controls ─────────────────────────────────────

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (videoRef.current && !videoRef.current.paused) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2000);
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setShowControls(true);
    } else {
      resetHideTimer();
    }
  }, [isPlaying, resetHideTimer]);

  // ── Fullscreen listener ────────────────────────────────────

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // ── Actions ────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const seek = useCallback((progress: number) => {
    const video = videoRef.current;
    if (!video || !isFinite(video.duration)) return;
    video.currentTime = progress * video.duration;
  }, []);

  const handleSetVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, v));
    if (video.muted && v > 0) video.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const handleSetPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      if ((e.target as HTMLElement).tagName === "INPUT") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          resetHideTimer();
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(video.duration, video.currentTime + 5);
          resetHideTimer();
          break;
        case "ArrowUp":
          e.preventDefault();
          handleSetVolume(video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          handleSetVolume(video.volume - 0.1);
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
      }
    },
    [togglePlay, handleSetVolume, toggleMute, toggleFullscreen, resetHideTimer],
  );

  // ── Derived state ──────────────────────────────────────────

  const progress = duration > 0 ? currentTime / duration : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col rounded-lg border-2 border-foreground bg-surface",
        !showControls && isPlaying && "cursor-none",
        isFullscreen && "border-0",
        className,
      )}
      onMouseMove={resetHideTimer}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* File name */}
      {fileName && (
        <div className={cn("border-b px-3 py-1.5")}>
          <span className="truncate text-xs text-muted-foreground">{fileName}</span>
        </div>
      )}

      {/* Video element */}
      <div
        className="relative cursor-pointer overflow-hidden bg-black"
        onClick={videoError ? undefined : togglePlay}
      >
        {!videoError && (
          <video
            ref={videoRef}
            src={src}
            className={cn("block w-full", isFullscreen && "max-h-screen")}
            preload="metadata"
            playsInline
          />
        )}

        {/* Unsupported codec / error overlay */}
        {videoError && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-4 p-8 text-center">
            <AlertTriangle className="size-10 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">{videoError}</p>
            {onDownload && (
              <Button variant="default" size="sm" onClick={onDownload}>
                <Download className="mr-2 size-4" />
                Download to play locally
              </Button>
            )}
          </div>
        )}

        {/* Loading overlay */}
        {!videoError && isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Big play button when paused and not loading */}
        {!videoError && !isPlaying && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-16 items-center justify-center rounded-sm border-2 border-foreground bg-surface/80">
              <Play className="ml-1 size-8" />
            </div>
          </div>
        )}
      </div>

      {/* Controls bar */}
      {!videoError && (
        <div
          className={cn(
            "flex cursor-default items-center gap-2 border-t bg-surface-sunken px-3 py-2",
          )}
        >
          {/* Play/Pause */}
          <Button variant="ghost" size="icon-sm" onClick={togglePlay} disabled={isLoading}>
            {isPlaying ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
          </Button>

          {/* Current time */}
          <span className="min-w-[5ch] font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(currentTime)}
          </span>

          {/* Scrub bar */}
          <div
            className="relative h-1 flex-1 cursor-pointer rounded-full bg-muted"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          {/* Duration */}
          <span className="min-w-[5ch] text-right font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(duration)}
          </span>

          {/* Speed control */}
          <div className="relative">
            <Button
              variant={showSpeed ? "default" : "ghost"}
              size="sm"
              className="font-mono text-xs"
              onClick={() => {
                setShowSpeed(!showSpeed);
                setShowVolume(false);
              }}
            >
              {playbackRate.toFixed(2)}x
            </Button>

            {showSpeed && (
              <div className="absolute bottom-full right-0 z-10 mb-1 w-56 rounded-md border bg-popover p-3 shadow-soft-md">
                <Dial
                  value={playbackRate}
                  onChange={handleSetPlaybackRate}
                  min={0.5}
                  max={2}
                  step={0.01}
                  notches={16}
                  label="Speed"
                  formatValue={(v) => `${v.toFixed(2)}x`}
                />
              </div>
            )}
          </div>

          {/* Volume control */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setShowVolume(!showVolume);
                setShowSpeed(false);
              }}
            >
              <VolumeIcon className="size-4" />
            </Button>

            {showVolume && (
              <div className="absolute bottom-full right-0 z-10 mb-1 rounded-md border bg-popover p-3 shadow-soft-md">
                <Fader
                  value={muted ? 0 : Math.round(volume * 100)}
                  onChange={(v) => handleSetVolume(v / 100)}
                  min={0}
                  max={100}
                  step={1}
                  notches={11}
                  label="Vol"
                  formatValue={(v) => `${v}%`}
                  className="h-32"
                />
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <Button variant="ghost" size="icon-sm" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      )}
    </div>
  );
}
