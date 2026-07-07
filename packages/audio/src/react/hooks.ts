/* oxlint-disable typescript/unbound-method -- zustand store methods are
   arrow functions on the store object; referencing them detached is the
   idiomatic selector pattern and never loses `this`. */
import { useContext, useMemo } from "react";
import { useStore } from "zustand";
import type { AudioPlayerStore, AudioPlayerStoreApi } from "../core/store";
import { AudioPlayerContext } from "./context";

function useAudioStoreApi(): AudioPlayerStoreApi {
  const store = useContext(AudioPlayerContext);
  if (!store) {
    throw new Error("useAudio* hooks must be used within AudioPlayerProvider");
  }
  return store;
}

function useStoreSelector<T>(selector: (state: AudioPlayerStore) => T): T {
  const store = useAudioStoreApi();
  return useStore(store, selector);
}

// ============================================================================
// Main Hook - useAudio()
// ============================================================================

/**
 * Main hook for audio control. Returns:
 * - initializeEngine() - call to initialize the audio engine
 * - isEngineReady - whether the engine is initialized
 * - All playback actions (play, pause, seek, etc.)
 * - Basic commonly-needed state
 *
 * For granular state subscriptions (render optimization), use the
 * specialized hooks: usePlaybackProgress, usePlaybackState, etc.
 */
export function useAudio() {
  const store = useAudioStoreApi();

  // Engine state
  const isEngineReady = useStoreSelector((s) => s.isEngineReady);

  // Basic state that's commonly needed
  const isPlaying = useStoreSelector((s) => s.isPlaying);
  const isLoading = useStoreSelector((s) => s.isLoading);
  const playable = useStoreSelector((s) => s.playable);

  return useMemo(
    () => ({
      // Engine initialization
      initializeEngine: store.getState().initializeEngine,
      isEngineReady,

      // Basic state
      isPlaying,
      isLoading,
      playable,

      // All actions
      loadPlayable: store.getState().loadPlayable,
      clearPlayable: store.getState().clearPlayable,
      play: store.getState().play,
      pause: store.getState().pause,
      stop: store.getState().stop,
      seek: store.getState().seek,
      toggle: store.getState().toggle,
      setPlaybackRate: store.getState().setPlaybackRate,
      setVolume: store.getState().setVolume,
      setMuted: store.getState().setMuted,
      toggleMute: store.getState().toggleMute,
      exportAudio: store.getState().exportAudio,
    }),
    [store, isEngineReady, isPlaying, isLoading, playable],
  );
}

// ============================================================================
// Granular Hooks - for render optimization
// ============================================================================

// Playback progress - updates frequently (60Hz)
export function usePlaybackProgress() {
  const currentTime = useStoreSelector((s) => s.currentTime);
  const duration = useStoreSelector((s) => s.duration);

  return useMemo(
    () => ({
      currentTime,
      duration,
      progress: duration > 0 ? currentTime / duration : 0,
    }),
    [currentTime, duration],
  );
}

// Playback state - updates on play/pause
export function usePlaybackState() {
  const isPlaying = useStoreSelector((s) => s.isPlaying);
  const isLoading = useStoreSelector((s) => s.isLoading);
  const isReady = useStoreSelector((s) => s.isReady);

  return useMemo(() => ({ isPlaying, isLoading, isReady }), [isPlaying, isLoading, isReady]);
}

// Just the playing boolean for simple toggle buttons
export function useIsPlaying(): boolean {
  return useStoreSelector((s) => s.isPlaying);
}

// Current playable info
export function useCurrentPlayable() {
  return useStoreSelector((s) => s.playable);
}

// Varispeed state
export function useVarispeed() {
  const playbackRate = useStoreSelector((s) => s.playbackRate);

  return useMemo(() => ({ playbackRate }), [playbackRate]);
}

// Volume state
export function useVolume() {
  const volume = useStoreSelector((s) => s.volume);
  const muted = useStoreSelector((s) => s.muted);

  return useMemo(() => ({ volume, muted }), [volume, muted]);
}

// Error state
export function useAudioError() {
  return useStoreSelector((s) => s.error);
}

// FSM state (for debugging/advanced use)
export function useFSMState() {
  return useStoreSelector((s) => s.fsm);
}

// Engine ready state
export function useIsEngineReady(): boolean {
  return useStoreSelector((s) => s.isEngineReady);
}

// Autoplay state
export function useAutoplay(): boolean {
  return useStoreSelector((s) => s.autoplay);
}

// Actions - stable reference, never changes
export function useAudioActions() {
  const store = useAudioStoreApi();

  return useMemo(
    () => ({
      initializeEngine: store.getState().initializeEngine,
      loadPlayable: store.getState().loadPlayable,
      clearPlayable: store.getState().clearPlayable,
      play: store.getState().play,
      pause: store.getState().pause,
      stop: store.getState().stop,
      seek: store.getState().seek,
      toggle: store.getState().toggle,
      togglePlayPause: store.getState().toggle, // Alias for backwards compat
      setPlaybackRate: store.getState().setPlaybackRate,
      setVolume: store.getState().setVolume,
      setMuted: store.getState().setMuted,
      toggleMute: store.getState().toggleMute,
      setAutoplay: store.getState().setAutoplay,
      exportAudio: store.getState().exportAudio,
      // Queue actions
      queueTrack: store.getState().queueTrack,
      playTrack: store.getState().playTrack,
      playFromQueue: store.getState().playFromQueue,
      next: store.getState().next,
      previous: store.getState().previous,
      clearQueue: store.getState().clearQueue,
      reorderQueue: store.getState().reorderQueue,
      removeFromQueue: store.getState().removeFromQueue,
    }),
    [store],
  );
}

// Full store access (escape hatch)
export function useAudioPlayerStore() {
  return useAudioStoreApi();
}

// Frequency data for spectrum visualization
export function useFrequencyData() {
  const store = useAudioStoreApi();

  return useMemo(
    () => ({
      getFrequencyData: () => {
        const engine = store.getState().engine;
        if (!engine) return null;
        return engine.getFrequencyData();
      },
    }),
    [store],
  );
}

// ============================================================================
// Queue Hooks
// ============================================================================

/**
 * Get the current track in the queue
 */
export function useCurrentTrack() {
  const queue = useStoreSelector((s) => s.queue);
  const currentIndex = useStoreSelector((s) => s.currentIndex);

  return useMemo(() => {
    if (currentIndex >= 0 && currentIndex < queue.length) {
      return queue[currentIndex] ?? null;
    }
    return null;
  }, [queue, currentIndex]);
}

/**
 * Get the full queue state
 */
export function useQueue() {
  const queue = useStoreSelector((s) => s.queue);
  const currentIndex = useStoreSelector((s) => s.currentIndex);

  return useMemo(() => ({ queue, currentIndex }), [queue, currentIndex]);
}

/**
 * Check if there's a next track
 */
export function useHasNext(): boolean {
  const queue = useStoreSelector((s) => s.queue);
  const currentIndex = useStoreSelector((s) => s.currentIndex);
  return currentIndex < queue.length - 1;
}

/**
 * Check if there's a previous track
 */
export function useHasPrevious(): boolean {
  const currentIndex = useStoreSelector((s) => s.currentIndex);
  return currentIndex > 0;
}

/**
 * Get queue manipulation actions (reorder, remove)
 */
export function useQueueActions() {
  const store = useAudioStoreApi();

  return useMemo(
    () => ({
      reorderQueue: store.getState().reorderQueue,
      removeFromQueue: store.getState().removeFromQueue,
    }),
    [store],
  );
}
