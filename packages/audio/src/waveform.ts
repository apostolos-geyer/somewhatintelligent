"use client";

const WAVEFORM_SAMPLES = 200; // Number of peaks to generate

export type WaveformAnalysis = {
  waveformData: string;
  durationMs: number;
};

/**
 * Generate waveform data from an audio file using Web Audio API
 *
 * @param file - The audio file to analyze
 * @returns An object with waveformData (JSON string of peaks) and durationMs
 */
export async function generateWaveformData(file: File): Promise<WaveformAnalysis> {
  // Create audio context
  const AudioContextClass =
    window.AudioContext ||
    // @ts-expect-error - webkitAudioContext for Safari
    window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported in this browser");
  }

  const audioContext = new AudioContextClass();

  try {
    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Decode audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Get duration in milliseconds
    const durationMs = Math.round(audioBuffer.duration * 1000);

    // Get channel data (use first channel for mono, or average stereo channels)
    let channelData: Float32Array;
    if (audioBuffer.numberOfChannels === 1) {
      channelData = audioBuffer.getChannelData(0);
    } else {
      // Average left and right channels for stereo
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      channelData = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) {
        channelData[i] = (left[i]! + right[i]!) / 2;
      }
    }

    // Generate peaks
    const samplesPerPeak = Math.floor(channelData.length / WAVEFORM_SAMPLES);
    const peaks: number[] = [];

    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, channelData.length);
      let max = 0;

      for (let j = start; j < end; j++) {
        const absValue = Math.abs(channelData[j] ?? 0);
        if (absValue > max) max = absValue;
      }

      // Round to 2 decimal places for storage efficiency
      peaks.push(Math.round(max * 100) / 100);
    }

    // Normalize peaks to 0-1 range
    const maxPeak = Math.max(...peaks);
    const normalizedPeaks = maxPeak > 0 ? peaks.map((p) => p / maxPeak) : peaks;

    return {
      waveformData: JSON.stringify(normalizedPeaks),
      durationMs,
    };
  } finally {
    // Always close the audio context to free resources
    await audioContext.close();
  }
}

/**
 * Generate waveform data from an audio URL using Web Audio API
 *
 * @param url - The audio URL to analyze
 * @returns An object with waveformData (JSON string of peaks) and durationMs
 */
export async function generateWaveformFromUrl(url: string): Promise<WaveformAnalysis> {
  // Create audio context
  const AudioContextClass =
    window.AudioContext ||
    // @ts-expect-error - webkitAudioContext for Safari
    window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not supported in this browser");
  }

  const audioContext = new AudioContextClass();

  try {
    // Fetch the audio file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    // Read as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Decode audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Get duration in milliseconds
    const durationMs = Math.round(audioBuffer.duration * 1000);

    // Get channel data (use first channel for mono, or average stereo channels)
    let channelData: Float32Array;
    if (audioBuffer.numberOfChannels === 1) {
      channelData = audioBuffer.getChannelData(0);
    } else {
      // Average left and right channels for stereo
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      channelData = new Float32Array(left.length);
      for (let i = 0; i < left.length; i++) {
        channelData[i] = (left[i]! + right[i]!) / 2;
      }
    }

    // Generate peaks
    const samplesPerPeak = Math.floor(channelData.length / WAVEFORM_SAMPLES);
    const peaks: number[] = [];

    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, channelData.length);
      let max = 0;

      for (let j = start; j < end; j++) {
        const absValue = Math.abs(channelData[j] ?? 0);
        if (absValue > max) max = absValue;
      }

      // Round to 2 decimal places for storage efficiency
      peaks.push(Math.round(max * 100) / 100);
    }

    // Normalize peaks to 0-1 range
    const maxPeak = Math.max(...peaks);
    const normalizedPeaks = maxPeak > 0 ? peaks.map((p) => p / maxPeak) : peaks;

    return {
      waveformData: JSON.stringify(normalizedPeaks),
      durationMs,
    };
  } finally {
    // Always close the audio context to free resources
    await audioContext.close();
  }
}

/**
 * Parse waveform data from a JSON string
 *
 * @param waveformData - JSON string of peak values
 * @returns Array of peak values (0-1)
 */
export function parseWaveformData(waveformData: string | null): number[] {
  if (!waveformData) {
    return [];
  }

  try {
    const peaks = JSON.parse(waveformData) as unknown;
    if (!Array.isArray(peaks)) {
      return [];
    }
    return peaks.filter((p): p is number => typeof p === "number");
  } catch {
    return [];
  }
}
