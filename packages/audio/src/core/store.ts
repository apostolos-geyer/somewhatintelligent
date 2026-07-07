/**
 * Audio player store with FSM-based state management and queue support.
 *
 * The store:
 * - Supports lazy engine initialization via engineFactory
 * - Subscribes to engine events when initialized
 * - Manages state via FSM (prevents invalid states)
 * - Orchestrates playback based on user intent
 * - Manages a queue of tracks with position tracking
 * - Persists queue and preferences to localStorage
 */

import { createJSONStorage, persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import {
  canTransition,
  createInitialFSMState,
  deriveFSMState,
  type FSMAction,
  type FSMState,
  fsmReducer,
} from "./fsm";
import { logger } from "./logger";
import type { AudioEngine, Playable, QueueTrack } from "./types";

// ============================================================================
// Types
// ============================================================================

export type EngineFactory = () => Promise<AudioEngine>;

export interface AudioPlayerState {
  // Engine state (supports lazy initialization) - NOT PERSISTED
  engine: AudioEngine | null;
  isEngineReady: boolean;

  // FSM state (source of truth for playback state) - NOT PERSISTED
  fsm: FSMState;

  // Derived from FSM for convenience - NOT PERSISTED
  isPlaying: boolean;
  isLoading: boolean;
  isReady: boolean;
  isTransitioning: boolean;

  // Playback position (not FSM-managed, updated via events) - NOT PERSISTED
  currentTime: number;
  duration: number;

  // Current playable - NOT PERSISTED
  playable: Playable | null;

  // Queue state - PERSISTED
  queue: QueueTrack[];
  currentIndex: number; // -1 = nothing in queue

  // Settings - PERSISTED
  playbackRate: number;
  volume: number;
  muted: boolean;
  autoplay: boolean;

  // Error - NOT PERSISTED
  error: Error | null;
}

export interface AudioPlayerActions {
  // Engine initialization (for lazy loading)
  initializeEngine(): Promise<void>;

  // Playable management (internal - use queue actions instead)
  loadPlayable(playable: Playable): Promise<void>;
  clearPlayable(): void;

  // Playback control
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  toggle(): Promise<void>;

  // Queue management
  queueTrack(tracks: QueueTrack[], options: { where: "next" | "end" }): void;
  playTrack(track: QueueTrack): Promise<void>;
  playFromQueue(index: number): Promise<void>;
  next(): Promise<QueueTrack | null>;
  previous(): Promise<QueueTrack | null>;
  clearQueue(): void;
  reorderQueue(fromIndex: number, toIndex: number): void;
  removeFromQueue(index: number): void;

  // Queue getters
  getCurrentTrack(): QueueTrack | null;
  hasNext(): boolean;
  hasPrevious(): boolean;

  // Varispeed
  setPlaybackRate(rate: number): void;

  // Volume
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;

  // Autoplay
  setAutoplay(enabled: boolean): void;

  // Export
  exportAudio(format: "wav" | "mp3"): Promise<Blob>;

  // Cleanup
  destroy(): void;
}

export type AudioPlayerStore = AudioPlayerState & AudioPlayerActions;

// ============================================================================
// Initial State
// ============================================================================

const initialFSM = createInitialFSMState();
const derivedInitial = deriveFSMState(initialFSM);

const initialState: AudioPlayerState = {
  engine: null,
  isEngineReady: false,
  fsm: initialFSM,
  ...derivedInitial,
  currentTime: 0,
  duration: 0,
  playable: null,
  queue: [],
  currentIndex: -1,
  playbackRate: 1,
  volume: 1,
  muted: false,
  autoplay: true,
  error: null,
};

/**
 * Convert a QueueTrack to a Playable for the audio engine.
 */
function queueTrackToPlayable(track: QueueTrack): Playable {
  return {
    id: track.id,
    url: track.streamingUrl,
    title: track.title,
    subtitle: track.artistName,
    imageUrl: track.coverUrl,
    durationMs: track.durationMs,
    waveformData: track.waveformData,
  };
}

// ============================================================================
// Store Factory
// ============================================================================

/**
 * Persisted state shape - only these fields are saved to localStorage.
 */
interface PersistedState {
  queue: QueueTrack[];
  currentIndex: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  autoplay: boolean;
}

/**
 * Create an audio player store with lazy engine initialization.
 * The store accepts an engineFactory and initializes the engine on demand.
 *
 * Queue and preferences are persisted to localStorage automatically.
 */
export function createAudioPlayerStore(
  engineFactory: EngineFactory,
  options?: { persistKey?: string; persistPlaybackRate?: boolean },
) {
  const persistKey = options?.persistKey ?? "audio-player";
  // Varispeed is a per-listening-session choice — defaults to 1x on each
  // fresh mount rather than resurrecting a stale value from localStorage
  // that would desync from the engine's own default on re-init. Apps that
  // want to remember the rate (e.g. a long-form player) can opt in explicitly.
  const persistPlaybackRate = options?.persistPlaybackRate ?? false;

  // Track unsubscribe functions for cleanup
  const unsubscribers: Array<() => void> = [];

  // Helper to get engine or throw
  const requireEngine = (get: () => AudioPlayerStore): AudioEngine => {
    const { engine } = get();
    if (!engine) {
      throw new Error("Audio engine not initialized. Call initializeEngine() first.");
    }
    return engine;
  };

  const store = createStore<AudioPlayerStore>()(
    persist(
      (set, get) => {
        // ========================================================================
        // FSM Dispatch
        // ========================================================================

        const dispatch = (action: FSMAction) => {
          const before = get().fsm.playbackState;
          set((state) => {
            const newFsm = fsmReducer(state.fsm, action);
            const derived = deriveFSMState(newFsm);
            return {
              fsm: newFsm,
              ...derived,
              error: newFsm.error ?? null,
            };
          });
          const after = get().fsm.playbackState;
          logger.store.dispatch(action.type, before !== after ? after : undefined);
        };

        // ========================================================================
        // Engine Event Subscription Setup
        // ========================================================================

        const subscribeToEngine = (engine: AudioEngine) => {
          // Play event - engine confirmed playback started
          unsubscribers.push(
            engine.on("play", () => {
              logger.store.event("play");
              const { fsm } = get();
              // Only dispatch if we're not already in playing state
              // (avoids redundant transitions)
              if (fsm.playbackState !== "playing") {
                dispatch({ type: "PLAY" });
              } else {
                logger.store.debug("play event ignored (already playing)");
              }
            }),
          );

          // Pause event - engine confirmed pause
          unsubscribers.push(
            engine.on("pause", () => {
              logger.store.event("pause");
              const { fsm } = get();
              // CRITICAL: Ignore pause events during transitioning!
              // These are internal stops during resampling, not user-requested.
              if (fsm.playbackState === "transitioning") {
                logger.store.debug("pause event ignored (transitioning)");
                return;
              }
              if (fsm.playbackState !== "paused" && fsm.playbackState !== "ready") {
                dispatch({ type: "PAUSE" });
              } else {
                logger.store.debug(`pause event ignored (already ${fsm.playbackState})`);
              }
            }),
          );

          // Loading event - async operation started (resampling)
          unsubscribers.push(
            engine.on("loading", () => {
              logger.store.event("loading");
              const { fsm } = get();
              if (canTransition(fsm.playbackState, "TRANSITION_START")) {
                dispatch({ type: "TRANSITION_START" });
              } else {
                logger.store.debug(
                  `loading event ignored (cannot transition from ${fsm.playbackState})`,
                );
              }
            }),
          );

          // Canplay event - buffer ready (after load or resampling)
          unsubscribers.push(
            engine.on("canplay", () => {
              logger.store.event("canplay");
              const { fsm, engine: currentEngine } = get();

              if (fsm.playbackState === "loading") {
                // Initial load complete
                dispatch({ type: "LOAD_SUCCESS" });
                if (currentEngine) {
                  set({ duration: currentEngine.getDuration() });
                }
              } else if (fsm.playbackState === "transitioning") {
                // Resampling complete - transition based on intent
                dispatch({ type: "TRANSITION_COMPLETE" });

                // If intent was 'play', restart playback
                const newState = get();
                if (newState.fsm.intent === "play" && currentEngine) {
                  logger.store.info("restarting playback after transition (intent: play)");
                  currentEngine.play();
                }
              } else {
                logger.store.debug(`canplay event ignored (state: ${fsm.playbackState})`);
              }
            }),
          );

          // Duration change
          unsubscribers.push(
            engine.on("durationchange", (duration) => {
              logger.store.event("durationchange", duration);
              const { engine: currentEngine } = get();
              if (currentEngine) {
                set({ duration: currentEngine.getDuration() });
              }
            }),
          );

          // Time update (don't log - too noisy)
          unsubscribers.push(
            engine.on("timeupdate", (time) => {
              set({ currentTime: time as number });
            }),
          );

          // Ended - playback reached end
          unsubscribers.push(
            engine.on("ended", () => {
              logger.store.event("ended");
              dispatch({ type: "PAUSE" });
              set({ currentTime: 0 });
            }),
          );

          // Error
          unsubscribers.push(
            engine.on("error", (err) => {
              logger.store.event("error", err);
              const error = err instanceof Error ? err : new Error(String(err));
              dispatch({ type: "LOAD_ERROR", error });
            }),
          );
        };

        // ========================================================================
        // Store Actions
        // ========================================================================

        return {
          ...initialState,

          async initializeEngine() {
            const { isEngineReady, engine } = get();

            // If already initialized AND engine exists, nothing to do
            if (isEngineReady && engine) {
              logger.store.debug("initializeEngine() ignored (already initialized)");
              return;
            }

            // Safety: if flag says ready but engine is null, reset flag
            if (isEngineReady && !engine) {
              logger.store.warn("initializeEngine() flag mismatch - resetting");
              set({ isEngineReady: false });
            }

            logger.store.info("initializeEngine() called");

            try {
              const newEngine = await engineFactory();
              subscribeToEngine(newEngine);
              set({ engine: newEngine, isEngineReady: true });
              logger.store.info("engine initialized successfully");
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              logger.store.error("engine initialization failed", error);
              throw error;
            }
          },

          async loadPlayable(playable: Playable) {
            // Ensure engine is initialized before loading
            await get().initializeEngine();

            const engine = requireEngine(get);
            logger.store.info("loadPlayable", {
              title: playable.title,
              url: playable.url,
            });

            // Can always start a new load
            dispatch({ type: "LOAD_START" });
            set({ playable, currentTime: 0, duration: 0 });

            try {
              await engine.load(playable.url);
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              dispatch({ type: "LOAD_ERROR", error });
            }
          },

          clearPlayable() {
            const engine = requireEngine(get);
            engine.stop();
            dispatch({ type: "DESTROY" });
            set({
              playable: null,
              currentTime: 0,
              duration: 0,
            });
          },

          /*Toggle play*/
          async play() {
            // Ensure engine is initialized before playing
            await get().initializeEngine();

            const engine = requireEngine(get);
            logger.store.info("play() called");
            const { fsm } = get();

            if (!canTransition(fsm.playbackState, "PLAY")) {
              logger.store.debug(`play() ignored (cannot transition from ${fsm.playbackState})`);
              return;
            }
            // Update intent immediately
            dispatch({ type: "PLAY" });

            // Tell engine to play - it will emit 'play' event when started
            await engine.play();
          },

          pause() {
            const engine = requireEngine(get);
            logger.store.info("pause() called");
            const { fsm } = get();

            if (!canTransition(fsm.playbackState, "PAUSE")) {
              logger.store.debug(`pause() ignored (cannot transition from ${fsm.playbackState})`);
              return;
            }

            // Update state
            dispatch({ type: "PAUSE" });

            // Tell engine to pause
            engine.pause();
          },

          stop() {
            const engine = requireEngine(get);
            logger.store.info("stop() called");
            const { fsm } = get();

            if (!canTransition(fsm.playbackState, "STOP")) {
              logger.store.debug(`stop() ignored (cannot transition from ${fsm.playbackState})`);
              return;
            }

            // Update state
            dispatch({ type: "STOP" });

            // Tell engine to stop
            engine.stop();
            set({ currentTime: 0 });
          },

          seek(time: number) {
            const engine = requireEngine(get);
            engine.seek(time);
            set({ currentTime: time });
          },

          async toggle() {
            const { fsm, queue, currentIndex, pause, play, playFromQueue } = get();

            // Retry from queue when in unloaded or error state
            if (
              (fsm.playbackState === "unloaded" || fsm.playbackState === "error") &&
              queue.length > 0 &&
              currentIndex >= 0 &&
              currentIndex < queue.length
            ) {
              await playFromQueue(currentIndex);
              return;
            }

            if (fsm.playbackState === "playing") {
              pause();
            } else {
              await play();
            }
          },

          // ======================================================================
          // Queue Management
          // ======================================================================

          queueTrack(tracks, { where }) {
            logger.store.info("queueTrack", { count: tracks.length, where });
            if (tracks.length === 0) return;

            set((state) => {
              if (where === "next") {
                // Insert after current index
                const insertIndex = state.currentIndex + 1;
                const newQueue = [
                  ...state.queue.slice(0, insertIndex),
                  ...tracks,
                  ...state.queue.slice(insertIndex),
                ];
                return { queue: newQueue };
              } else {
                // Append to end
                return { queue: [...state.queue, ...tracks] };
              }
            });
          },

          async playTrack(track) {
            logger.store.info("playTrack", {
              id: track.id,
              title: track.title,
            });

            // Replace queue with just this track
            set({ queue: [track], currentIndex: 0 });

            // Load and play
            const playable = queueTrackToPlayable(track);
            await get().initializeEngine();
            await get().loadPlayable(playable);
            await get().play();
          },

          async playFromQueue(index) {
            const { queue } = get();
            logger.store.info("playFromQueue", {
              index,
              queueLength: queue.length,
            });

            if (index < 0 || index >= queue.length) {
              logger.store.warn("playFromQueue: index out of bounds");
              return;
            }

            const track = queue[index];
            if (!track) return;

            set({ currentIndex: index });

            // Load and play
            const playable = queueTrackToPlayable(track);
            await get().initializeEngine();
            await get().loadPlayable(playable);
            await get().play();
          },

          async next() {
            const { queue, currentIndex } = get();
            logger.store.info("next", {
              currentIndex,
              queueLength: queue.length,
            });

            if (currentIndex >= queue.length - 1) {
              logger.store.debug("next: at end of queue");
              return null;
            }

            const newIndex = currentIndex + 1;
            const track = queue[newIndex];
            if (!track) return null;

            set({ currentIndex: newIndex });

            // Load and play the next track
            const playable = queueTrackToPlayable(track);
            await get().initializeEngine();
            await get().loadPlayable(playable);
            await get().play();

            return track;
          },

          async previous() {
            const { queue, currentIndex } = get();
            logger.store.info("previous", {
              currentIndex,
              queueLength: queue.length,
            });

            if (currentIndex <= 0) {
              logger.store.debug("previous: at start of queue");
              return null;
            }

            const newIndex = currentIndex - 1;
            const track = queue[newIndex];
            if (!track) return null;

            set({ currentIndex: newIndex });

            // Load and play the previous track
            const playable = queueTrackToPlayable(track);
            await get().initializeEngine();
            await get().loadPlayable(playable);
            await get().play();

            return track;
          },

          clearQueue() {
            logger.store.info("clearQueue");
            const { engine } = get();
            if (engine) {
              engine.stop();
            }
            dispatch({ type: "DESTROY" });
            set({
              queue: [],
              currentIndex: -1,
              playable: null,
              currentTime: 0,
              duration: 0,
            });
          },

          reorderQueue(fromIndex, toIndex) {
            logger.store.info("reorderQueue", { fromIndex, toIndex });
            const { queue, currentIndex } = get();

            // Only allow reordering tracks after current
            if (fromIndex <= currentIndex || toIndex <= currentIndex) {
              logger.store.debug("reorderQueue: cannot reorder at or before current");
              return;
            }
            if (fromIndex < 0 || fromIndex >= queue.length) return;
            if (toIndex < 0 || toIndex >= queue.length) return;
            if (fromIndex === toIndex) return;

            const newQueue = [...queue];
            const [removed] = newQueue.splice(fromIndex, 1);
            if (removed) {
              newQueue.splice(toIndex, 0, removed);
              set({ queue: newQueue });
            }
          },

          removeFromQueue(index) {
            logger.store.info("removeFromQueue", { index });
            const { queue, currentIndex } = get();

            // Only allow removing tracks after current
            if (index <= currentIndex) {
              logger.store.debug("removeFromQueue: cannot remove at or before current");
              return;
            }
            if (index < 0 || index >= queue.length) return;

            const newQueue = queue.filter((_, i) => i !== index);
            set({ queue: newQueue });
          },

          getCurrentTrack() {
            const { queue, currentIndex } = get();
            if (currentIndex >= 0 && currentIndex < queue.length) {
              return queue[currentIndex] ?? null;
            }
            return null;
          },

          hasNext() {
            const { queue, currentIndex } = get();
            return currentIndex < queue.length - 1;
          },

          hasPrevious() {
            const { currentIndex } = get();
            return currentIndex > 0;
          },

          // ======================================================================
          // Settings
          // ======================================================================

          setPlaybackRate(rate: number) {
            const engine = requireEngine(get);
            logger.store.info("setPlaybackRate", { rate });
            // Engine will emit 'loading' if resampling is needed
            // Store will handle TRANSITION_START in event handler
            engine.setPlaybackRate(rate);
            set({ playbackRate: rate });
          },

          setVolume(volume: number) {
            const engine = requireEngine(get);
            engine.setVolume(volume);
            set({ volume });
          },

          setMuted(muted: boolean) {
            const engine = requireEngine(get);
            engine.setMuted(muted);
            set({ muted });
          },

          toggleMute() {
            const { muted } = get();
            get().setMuted(!muted);
          },

          setAutoplay(enabled: boolean) {
            logger.store.info("setAutoplay", { enabled });
            set({ autoplay: enabled });
          },

          async exportAudio(format: "wav" | "mp3") {
            const engine = requireEngine(get);
            logger.store.info("exportAudio() called", { format });
            return engine.exportWithEffects({ format });
          },

          destroy() {
            logger.store.info("destroy() called");

            // Unsubscribe from all engine events
            logger.store.debug(`unsubscribing from ${unsubscribers.length} engine events`);
            for (const unsub of unsubscribers) {
              unsub();
            }
            unsubscribers.length = 0;

            // Reset state
            dispatch({ type: "DESTROY" });

            // Destroy engine if it exists
            const { engine } = get();
            if (engine) {
              logger.store.debug("destroying engine");
              engine.destroy();
            }

            set(initialState);
          },
        };
      },
      {
        name: persistKey,
        storage: createJSONStorage(() => {
          // Only use localStorage in browser environment
          if (typeof window !== "undefined") {
            return localStorage;
          }
          // Return a no-op storage for SSR
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }),
        partialize: (state): PersistedState => ({
          queue: state.queue,
          currentIndex: state.currentIndex,
          volume: state.volume,
          muted: state.muted,
          playbackRate: persistPlaybackRate ? state.playbackRate : 1,
          autoplay: state.autoplay,
        }),
      },
    ),
  );

  return store;
}

export type AudioPlayerStoreApi = ReturnType<typeof createAudioPlayerStore>;
