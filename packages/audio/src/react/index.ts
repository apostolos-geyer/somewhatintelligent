// Provider
export { AudioPlayerProvider } from "./provider";
export type { AudioPlayerProviderProps } from "./provider";

// Main hook
export { useAudio } from "./hooks";

// Granular hooks - for render optimization
export {
  usePlaybackProgress,
  usePlaybackState,
  useIsPlaying,
  useCurrentPlayable,
  useVarispeed,
  useVolume,
  useAudioError,
  useFSMState,
  useIsEngineReady,
  useAutoplay,
  useAudioActions,
  useAudioPlayerStore,
  useFrequencyData,
  // Queue hooks
  useCurrentTrack,
  useQueue,
  useHasNext,
  useHasPrevious,
  useQueueActions,
} from "./hooks";

// Media Session bridge - auto-wired by AudioPlayerProvider, exported for advanced use
export { useMediaSessionBridge } from "./use-media-session-bridge";

// Store types - re-exported from core for convenience
export type {
  AudioPlayerState,
  AudioPlayerActions,
  AudioPlayerStore,
  AudioPlayerStoreApi,
  EngineFactory,
} from "../core/store";
export { createAudioPlayerStore } from "../core/store";

// Queue types - re-exported from core
export type { QueueTrack } from "../core/types";

// Selectors - for auto-generated hooks
export type { WithSelectors } from "../core/selectors";
export { createSelectors } from "../core/selectors";

// Context (for advanced use cases)
export { AudioPlayerContext } from "./context";
