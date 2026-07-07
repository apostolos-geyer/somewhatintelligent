import * as Tone from "tone";
import type { AudioEngine, EngineEvent, EngineEventCallback, ExportOptions } from "../core";
import type { PlaybackState } from "../core/fsm";
import { logger } from "../core/logger";

/**
 * Creates a web audio engine using Tone.js.
 * Must be called after user interaction (click/keydown) to start AudioContext.
 */
export async function createWebAudioEngine(): Promise<AudioEngine> {
  // Initialize Tone.js context
  await Tone.start();

  // State
  let player: Tone.Player | null = null;
  let analyser: Tone.Analyser | null = null;
  let volume = 1;
  let muted = false;
  let ready = false;
  let targetRate = 1;

  // Track current playback position
  let lastKnownPosition = 0;
  // Track when playback started (AudioContext time) and from what offset
  let playbackStartTime = 0;
  let playbackStartOffset = 0;

  // Event listeners
  const listeners = new Map<EngineEvent, Set<EngineEventCallback>>();

  // Time update polling
  let timeUpdateInterval: ReturnType<typeof setInterval> | null = null;

  const emit = (event: EngineEvent, data?: unknown, sync = false) => {
    // Don't log timeupdate - too noisy
    if (event !== "timeupdate") {
      console.log("emit", { event, data, sync });
      logger.engine.emit(event, data);
    }

    const deliver = () => {
      const evts = listeners.get(event);
      if (evts === undefined) return;
      for (const cb of evts) {
        cb(data);
      }
    };

    if (sync) {
      // Synchronous delivery for operations that complete immediately
      deliver();
    } else {
      // Async delivery to allow listeners to be registered after
      // the triggering call returns (consistent with browser event behavior)
      setTimeout(deliver, 0);
    }
  };

  const startTimeUpdates = () => {
    if (timeUpdateInterval) return;
    timeUpdateInterval = setInterval(() => {
      if (player?.state === "started") {
        // Calculate position: offset + elapsed time * rate
        const elapsed = Tone.now() - playbackStartTime;
        const currentBufferPos = playbackStartOffset + elapsed * player.playbackRate;
        lastKnownPosition = currentBufferPos;

        // Clamp to valid range
        const maxDuration = player.buffer?.duration ?? 0;
        lastKnownPosition = Math.max(0, Math.min(lastKnownPosition, maxDuration));

        emit("timeupdate", lastKnownPosition);
      }
    }, 50); // ~20fps
  };

  const stopTimeUpdates = () => {
    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
      timeUpdateInterval = null;
    }
  };

  const engine: AudioEngine = {
    async load(url: string) {
      logger.engine.action("load", { url });
      ready = false;

      // Reset position tracking for new track
      lastKnownPosition = 0;
      playbackStartTime = 0;
      playbackStartOffset = 0;
      stopTimeUpdates();
      emit("timeupdate", 0);

      // Dispose old player
      player?.stop();
      player?.dispose();

      // Create new player
      // onstop is unused: pause()/stop() already emit 'pause' manually, and
      // player.stop() triggers onstop, which would double-emit it.
      player = new Tone.Player({
        url,
        onload: () => {
          ready = true;
          emit("canplay", undefined, true);
          emit("durationchange", player?.buffer.duration ?? 0);
        },
        onerror: (err) => {
          ready = false;
          emit("error", err);
        },
      });

      // Apply current settings
      player.playbackRate = targetRate;
      player.volume.value = muted ? -Infinity : Tone.gainToDb(volume);

      // Create analyser and route audio through it
      if (!analyser) {
        analyser = new Tone.Analyser("fft", 64); // 64 frequency bins
        analyser.toDestination();
      }

      // Connect player through analyser to destination
      player.connect(analyser);

      // Wait for load
      try {
        await Tone.loaded();
      } catch (err) {
        ready = false;
        emit("error", err);
      }
    },

    async play() {
      logger.engine.action("play");
      if (!player?.loaded) {
        logger.engine.debug("play ignored (not loaded)");
        return;
      }
      // Don't start if already playing
      if (player.state === "started") {
        logger.engine.debug("play ignored (already started)");
        return;
      }

      // Record when we started and from what offset
      playbackStartTime = Tone.now();
      playbackStartOffset = lastKnownPosition;

      logger.engine.debug("starting playback", { position: lastKnownPosition });
      // Start playback from the offset
      player.start(undefined, lastKnownPosition);
      emit("play");
      startTimeUpdates();
    },

    pause() {
      logger.engine.action("pause");
      if (!player) return;
      player.stop();
      stopTimeUpdates();
      // lastKnownPosition is already updated by the timeupdate interval
      emit("pause");
    },

    stop() {
      logger.engine.action("stop");
      if (!player) return;
      player.stop();
      stopTimeUpdates();
      // Reset position to beginning
      lastKnownPosition = 0;
      playbackStartOffset = 0;
      emit("pause");
      emit("timeupdate", 0);
    },

    seek(time: number) {
      logger.engine.action("seek", { time });
      if (!player?.loaded) return;
      const maxDuration = player.buffer.duration;
      const clampedTime = Math.max(0, Math.min(time, maxDuration));

      // Update tracked position
      lastKnownPosition = clampedTime;

      const wasPlaying = player.state === "started";
      if (wasPlaying) {
        player.stop();
        // Reset tracking for new start position
        playbackStartTime = Tone.now();
        playbackStartOffset = clampedTime;
        player.start(undefined, clampedTime);
      }

      emit("timeupdate", clampedTime);
    },

    setVolume(vol: number) {
      volume = Math.max(0, Math.min(1, vol));
      if (player && !muted) {
        player.volume.value = Tone.gainToDb(volume);
      }
    },

    setMuted(m: boolean) {
      muted = m;
      if (player) {
        player.volume.value = muted ? -Infinity : Tone.gainToDb(volume);
      }
    },

    setPlaybackRate(rate: number) {
      const newRate = Math.max(0.1, Math.min(4, rate));
      const rateChanged = Math.abs(newRate - targetRate) > 0.001;

      if (!rateChanged) {
        logger.engine.debug("setPlaybackRate ignored (no change)");
        return;
      }

      logger.engine.action("setPlaybackRate", {
        from: targetRate,
        to: newRate,
      });

      // Re-anchor the polling offset before flipping the rate. The timeupdate
      // interval computes pos = offset + (Tone.now() - startTime) * rate, so
      // without this the new rate retroactively applies to wall time already
      // spent at the old rate and the buffer position jumps on every change.
      if (player?.state === "started") {
        const elapsed = Tone.now() - playbackStartTime;
        playbackStartOffset = playbackStartOffset + elapsed * player.playbackRate;
        playbackStartTime = Tone.now();
      }

      // Update target state
      targetRate = newRate;

      // Apply directly to player
      if (player) {
        player.playbackRate = newRate;
      }
    },

    getCurrentTime() {
      if (!player?.loaded) return 0;
      // Return the tracked position (updated via timeupdate interval)
      return lastKnownPosition;
    },

    getDuration() {
      return player?.buffer?.duration ?? 0;
    },

    isReady() {
      return ready;
    },

    getPlaybackRate() {
      return targetRate;
    },

    getPlaybackState(): PlaybackState {
      // Derive playback state from engine internals
      if (!player) return "unloaded";
      if (!ready) return "loading";
      if (player.state === "started") return "playing";
      if (lastKnownPosition > 0) return "paused";
      return "ready";
    },

    on(event: EngineEvent, callback: EngineEventCallback): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(callback);

      // Return unsubscribe function
      return () => {
        listeners.get(event)?.delete(callback);
      };
    },

    async exportWithEffects(_options: ExportOptions): Promise<Blob> {
      if (!player?.buffer) {
        throw new Error("No audio loaded for export");
      }

      const sourceBuffer = player.buffer.get();
      if (!sourceBuffer) {
        throw new Error("Audio buffer unavailable");
      }

      const rate = targetRate;
      const sampleRate = sourceBuffer.sampleRate;
      const channels = sourceBuffer.numberOfChannels;
      // Duration changes inversely with playback rate
      const outputDuration = sourceBuffer.duration / rate;
      const outputLength = Math.ceil(outputDuration * sampleRate);

      // Render offline at the altered rate
      const offlineCtx = new OfflineAudioContext(channels, outputLength, sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = sourceBuffer;
      source.playbackRate.value = rate;
      source.connect(offlineCtx.destination);
      source.start(0);

      const rendered = await offlineCtx.startRendering();

      // Encode as WAV
      return encodeWav(rendered);
    },

    getFrequencyData() {
      if (!analyser) return null;
      const values = analyser.getValue();
      // Tone.Analyser returns Float32Array for FFT analysis
      return values as Float32Array;
    },

    getAnalyserNode() {
      if (!analyser) return null;
      // Get the underlying Web Audio API AnalyserNode
      return analyser.context.rawContext.createAnalyser();
    },

    destroy() {
      logger.engine.action("destroy");
      stopTimeUpdates();
      player?.stop();
      player?.dispose();
      analyser?.dispose();
      player = null;
      analyser = null;
      listeners.clear();
      logger.engine.debug("engine destroyed");
    },
  };

  return engine;
}

/**
 * Encode an AudioBuffer as a 32-bit float WAV file blob.
 * Uses IEEE 754 float format (format tag 3) to preserve the full
 * precision of the OfflineAudioContext render with zero quantization.
 */
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 4; // 32-bit float
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 3, true); // IEEE float format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 32, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels and write 32-bit float samples directly
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setFloat32(offset, channels[ch]![i]!, true);
      offset += 4;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
