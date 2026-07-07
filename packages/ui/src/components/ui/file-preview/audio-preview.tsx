"use client";

import { useEffect, useRef, useState } from "react";
import { AudioPlayerProvider } from "@si/audio/react";
import { createWebAudioEngine } from "@si/audio/web";
import { generateWaveformFromUrl } from "@si/audio/waveform";
import { AudioPlayer } from "./audio-player";

interface AudioPreviewProps {
  url: string;
  fileName: string;
}

export function AudioPreview({ url, fileName }: AudioPreviewProps) {
  return (
    <AudioPlayerProvider engineFactory={createWebAudioEngine}>
      <AudioPlayerInner url={url} fileName={fileName} />
    </AudioPlayerProvider>
  );
}

function AudioPlayerInner({ url, fileName }: AudioPreviewProps) {
  const [waveformData, setWaveformData] = useState<string | null>(null);
  const computingRef = useRef(false);

  useEffect(() => {
    if (computingRef.current) return;
    computingRef.current = true;

    generateWaveformFromUrl(url)
      .then((result) => setWaveformData(result.waveformData))
      .catch(() => {});
  }, [url]);

  return <AudioPlayer url={url} fileName={fileName} waveformData={waveformData} />;
}
