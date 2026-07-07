"use client";

import { useEffect } from "react";
import type { AudioPlayerStore, AudioPlayerStoreApi } from "../core/store";

const POSITION_UPDATE_THROTTLE_MS = 1000;

type ArtworkSize = { src: string; sizes: string; type?: string };

function buildArtwork(imageUrl: string | null | undefined): ArtworkSize[] {
  if (!imageUrl) return [];
  return [
    { src: imageUrl, sizes: "96x96" },
    { src: imageUrl, sizes: "192x192" },
    { src: imageUrl, sizes: "512x512" },
  ];
}

/**
 * Reflects audio store state to the OS-level Now Playing UI
 * (lock screen, Control Center, AirPods, Bluetooth car displays).
 *
 * Bypasses the iOS silent/ringer switch by setting
 * `navigator.audioSession.type = "playback"` (Safari 16.4+, iOS 17+).
 *
 * Wires `navigator.mediaSession` action handlers to store actions so
 * hardware buttons and lock-screen controls drive playback.
 *
 * Idempotent and feature-gated; safe in SSR and unsupported browsers.
 */
export function useMediaSessionBridge(store: AudioPlayerStoreApi) {
  useEffect(() => {
    if (typeof navigator === "undefined") return;

    const supportsMediaSession = "mediaSession" in navigator;
    const supportsAudioSession = "audioSession" in navigator;
    if (!supportsMediaSession && !supportsAudioSession) return;

    if (supportsAudioSession) {
      try {
        // @ts-expect-error - AudioSession is experimental, not in lib.dom yet
        navigator.audioSession.type = "playback";
      } catch {
        // Some browsers throw on assignment of unsupported values; ignore.
      }
    }

    if (!supportsMediaSession) return;

    const ms = navigator.mediaSession;

    const safeSet = <T>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch {
        return undefined;
      }
    };

    safeSet(() => ms.setActionHandler("play", () => void store.getState().play()));
    safeSet(() => ms.setActionHandler("pause", () => store.getState().pause()));
    safeSet(() => ms.setActionHandler("stop", () => store.getState().stop()));
    safeSet(() =>
      ms.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") {
          store.getState().seek(details.seekTime);
        }
      }),
    );
    safeSet(() =>
      ms.setActionHandler("seekbackward", (details) => {
        const offset = details.seekOffset ?? 10;
        const { currentTime, seek } = store.getState();
        seek(Math.max(0, currentTime - offset));
      }),
    );
    safeSet(() =>
      ms.setActionHandler("seekforward", (details) => {
        const offset = details.seekOffset ?? 10;
        const { currentTime, duration, seek } = store.getState();
        seek(Math.min(duration, currentTime + offset));
      }),
    );
    safeSet(() =>
      ms.setActionHandler("previoustrack", () => {
        if (store.getState().hasPrevious()) void store.getState().previous();
      }),
    );
    safeSet(() =>
      ms.setActionHandler("nexttrack", () => {
        if (store.getState().hasNext()) void store.getState().next();
      }),
    );

    let lastPlayableId: string | null = null;
    let lastPlayState: boolean | null = null;
    let lastPositionPushAt = 0;

    const pushPositionState = (duration: number, currentTime: number, playbackRate: number) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      const position = Math.max(0, Math.min(currentTime, duration));
      const rate = playbackRate > 0 ? playbackRate : 1;
      safeSet(() => ms.setPositionState({ duration, position, playbackRate: rate }));
    };

    const unsubscribe = store.subscribe((state: AudioPlayerStore, prev: AudioPlayerStore) => {
      if (state.playable !== prev.playable) {
        const playable = state.playable;
        if (playable) {
          safeSet(
            () =>
              (ms.metadata = new MediaMetadata({
                title: playable.title ?? "",
                artist: playable.subtitle ?? "",
                artwork: buildArtwork(playable.imageUrl),
              })),
          );
          lastPlayableId = playable.id;
        } else {
          safeSet(() => (ms.metadata = null));
          lastPlayableId = null;
        }
      }

      if (state.isPlaying !== lastPlayState) {
        ms.playbackState = state.isPlaying ? "playing" : "paused";
        lastPlayState = state.isPlaying;
      }

      if (state.playable === null) {
        ms.playbackState = "none";
      }

      const now = Date.now();
      const positionDirty =
        state.duration !== prev.duration ||
        state.playbackRate !== prev.playbackRate ||
        Math.abs(state.currentTime - prev.currentTime) > 1.5;

      if (positionDirty || now - lastPositionPushAt > POSITION_UPDATE_THROTTLE_MS) {
        pushPositionState(state.duration, state.currentTime, state.playbackRate);
        lastPositionPushAt = now;
      }
    });

    // Hydrate from current state on mount.
    const initial = store.getState();
    if (initial.playable) {
      safeSet(
        () =>
          (ms.metadata = new MediaMetadata({
            title: initial.playable?.title ?? "",
            artist: initial.playable?.subtitle ?? "",
            artwork: buildArtwork(initial.playable?.imageUrl),
          })),
      );
      lastPlayableId = initial.playable.id;
      ms.playbackState = initial.isPlaying ? "playing" : "paused";
      lastPlayState = initial.isPlaying;
      pushPositionState(initial.duration, initial.currentTime, initial.playbackRate);
    }

    void lastPlayableId;

    return () => {
      unsubscribe();
      const actions = [
        "play",
        "pause",
        "stop",
        "seekto",
        "seekbackward",
        "seekforward",
        "previoustrack",
        "nexttrack",
      ] as const;
      for (const action of actions) {
        safeSet(() => ms.setActionHandler(action, null));
      }
      safeSet(() => (ms.metadata = null));
      ms.playbackState = "none";
    };
  }, [store]);
}
