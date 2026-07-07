"use client";

import { Suspense, lazy } from "react";

import { Dialog, DialogContent } from "../dialog";
import { isImage, isVideo } from "../file-icon";

const VideoPlayer = lazy(() => import("../video-player").then((m) => ({ default: m.VideoPlayer })));

interface ModalPreviewProps {
  url: string;
  fileName: string;
  mimeType: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: () => void;
}

export function ModalPreview({
  url,
  fileName,
  mimeType,
  open,
  onOpenChange,
  onDownload,
}: ModalPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[calc(100%-2rem)] border-none bg-transparent p-0 shadow-none backdrop-blur-none sm:max-w-[calc(100%-4rem)] lg:max-w-6xl"
      >
        {isVideo(mimeType) ? (
          <Suspense fallback={null}>
            <VideoPlayer src={url} fileName={fileName} onDownload={onDownload} />
          </Suspense>
        ) : isImage(mimeType) ? (
          <img
            src={url}
            alt={fileName}
            className="mx-auto max-h-[90vh] w-auto rounded-lg object-contain"
          />
        ) : (
          <iframe src={url} title={fileName} className="h-[90vh] w-full rounded-lg bg-white" />
        )}
      </DialogContent>
    </Dialog>
  );
}
