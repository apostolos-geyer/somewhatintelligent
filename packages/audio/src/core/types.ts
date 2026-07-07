import type { PlaybackState } from "./fsm";

/**
 * Domain-agnostic representation of anything the player can play.
 * Constructed from domain objects (Track, WorkspaceDraft, etc.) at the call site.
 */
export interface Playable {
  id: string;
  url: string;

  // Optional metadata for UI display
  title?: string;
  subtitle?: string;
  imageUrl?: string | null;
  durationMs?: number;
  waveformData?: string | null;
}

/**
 * Generic queue track with domain-agnostic fields.
 * The Context type parameter allows callers to attach domain-specific metadata.
 *
 * @example
 * // Release context
 * type ReleaseContext = { releaseId: string; releaseTitle: string };
 * const track: QueueTrack<ReleaseContext> = { ..., context: { releaseId: '...', releaseTitle: '...' } };
 *
 * // No context
 * const track: QueueTrack = { ..., context: null };
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface QueueTrack<Context extends object = {}> {
  id: string;
  title: string;
  artistName: string;
  coverUrl: string | null;
  durationMs: number;
  waveformData: string | null;
  streamingUrl: string;
  streamingUrlExpiresAt: Date;
  context: Context | null;
}

/**
 * Events emitted by the audio engine.
 */
export type EngineEvent =
  | "timeupdate"
  | "durationchange"
  | "play"
  | "pause"
  | "ended"
  | "waiting"
  | "canplay"
  | "loading"
  | "error";

/**
 * Callback type for engine events.
 */
export type EngineEventCallback = (data?: unknown) => void;

/**
 * Options for exporting audio with effects baked in.
 */
export interface ExportOptions {
  format: "wav" | "mp3";
  onProgress?: (progress: number) => void;
}

/**
 * The audio engine interface.
 * Implementations provide platform-specific audio playback with varispeed capabilities.
 */
export interface AudioEngine {
  // Lifecycle
  load(url: string): Promise<void>;
  destroy(): void;

  // Playback control
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seek(time: number): void;

  // Basic audio
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;

  // Varispeed
  setPlaybackRate(rate: number): void;

  // State queries
  getCurrentTime(): number;
  getDuration(): number;
  isReady(): boolean;
  getPlaybackRate(): number;
  getPlaybackState(): PlaybackState;

  // Events - returns unsubscribe function
  on(event: EngineEvent, callback: EngineEventCallback): () => void;

  // Export
  exportWithEffects(options: ExportOptions): Promise<Blob>;

  // Real-time frequency analysis
  getFrequencyData(): Float32Array | null;
  getAnalyserNode(): AnalyserNode | null;
}
