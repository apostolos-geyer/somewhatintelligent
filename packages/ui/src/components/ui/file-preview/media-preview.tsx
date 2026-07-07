"use client";

import { Suspense, lazy } from "react";

import { isAudio, isDocument } from "../file-icon";

const AudioPreview = lazy(() =>
  import("./audio-preview").then((m) => ({ default: m.AudioPreview })),
);
const ComingSoonPreview = lazy(() =>
  import("./coming-soon-preview").then((m) => ({ default: m.ComingSoonPreview })),
);

export interface MediaPreviewFeatures {
  audio?: boolean;
  document?: boolean;
}

interface MediaPreviewProps {
  fileName: string;
  mimeType: string | null;
  previewUrl: string;
  features?: MediaPreviewFeatures;
}

const PreviewFallback = () => (
  <div className="text-text-tertiary bg-surface-sunken border-border rounded-sm border p-4 font-mono text-xs">
    loading preview…
  </div>
);

export function MediaPreview({
  fileName,
  mimeType,
  previewUrl,
  features = { audio: true, document: true },
}: MediaPreviewProps) {
  if (features.audio !== false && isAudio(mimeType)) {
    return (
      <Suspense fallback={<PreviewFallback />}>
        <AudioPreview url={previewUrl} fileName={fileName} />
      </Suspense>
    );
  }

  if (features.document !== false && isDocument(mimeType) && mimeType !== "application/pdf") {
    return (
      <Suspense fallback={<PreviewFallback />}>
        <ComingSoonPreview type="document" />
      </Suspense>
    );
  }

  return null;
}
