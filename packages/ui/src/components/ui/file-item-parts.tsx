"use client";

import { Suspense, lazy, useCallback, useState } from "react";
import { ArrowDownToLineIcon, ChevronUpIcon, EyeIcon, Loader2Icon, XIcon } from "lucide-react";

import { cn } from "@si/ui/lib/utils";
import { ItemContent, ItemDescription, ItemTitle } from "./item";
import type { MediaPreviewFeatures } from "./file-preview/media-preview";
import { MediaPreview } from "./file-preview/media-preview";

const ModalPreview = lazy(() =>
  import("./file-preview/modal-preview").then((m) => ({ default: m.ModalPreview })),
);

const DEFAULT_KIND_COLOR = "var(--color-border-strong)";

export function useFilePreview({
  fetchPreviewUrl,
  canModalPreview,
}: {
  fetchPreviewUrl: (() => Promise<string>) | undefined;
  canModalPreview: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const ensureUrl = useCallback(async () => {
    if (previewUrl || !fetchPreviewUrl) return previewUrl;
    setLoadingPreview(true);
    try {
      const url = await fetchPreviewUrl();
      setPreviewUrl(url);
      return url;
    } finally {
      setLoadingPreview(false);
    }
  }, [previewUrl, fetchPreviewUrl]);

  const handlePreview = useCallback(async () => {
    if (canModalPreview) {
      const url = previewUrl ?? (await ensureUrl());
      if (url) setModalOpen(true);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    const url = previewUrl ?? (await ensureUrl());
    if (url) setExpanded(true);
  }, [canModalPreview, previewUrl, ensureUrl, expanded]);

  return { expanded, modalOpen, setModalOpen, previewUrl, loadingPreview, handlePreview };
}

export function FileThumbnail({
  ext,
  compact,
  gradient,
  kindColor = DEFAULT_KIND_COLOR,
}: {
  ext: string;
  compact: boolean;
  gradient?: string;
  kindColor?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center font-mono font-bold tracking-wider",
        compact
          ? "h-8 w-8 rounded-sm border text-[9px]"
          : "shadow-soft-sm h-14 w-14 rounded-sm border-[1.5px] text-[11px]",
      )}
      style={{
        background: gradient || "var(--color-surface-sunken)",
        borderColor: kindColor,
        color: gradient ? "var(--color-text-on-accent)" : kindColor,
      }}
    >
      {ext}
    </div>
  );
}

export function FileItemBody({
  name,
  sizeText,
  meta,
  compact,
}: {
  name: string;
  sizeText: string;
  meta: string;
  compact: boolean;
}) {
  return (
    <ItemContent className={cn(compact ? "gap-0" : "gap-0.5")}>
      <ItemTitle className="text-text block truncate text-sm font-medium">{name}</ItemTitle>
      <ItemDescription className="text-text-tertiary font-mono text-xs tracking-wide">
        {compact ? sizeText : `${sizeText} · ${meta}`}
      </ItemDescription>
    </ItemContent>
  );
}

function PreviewToggleButton({
  loading,
  expanded,
  onClick,
}: {
  loading: boolean;
  expanded: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={loading}
      aria-label={expanded ? "Collapse preview" : "Show preview"}
      className="border-border text-text-tertiary hover:text-text inline-flex h-8 cursor-pointer items-center justify-center rounded-sm border px-2 font-mono text-xs uppercase tracking-wider disabled:opacity-50"
    >
      {loading ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : expanded ? (
        <ChevronUpIcon className="size-3.5" />
      ) : (
        <EyeIcon className="size-3.5" />
      )}
    </button>
  );
}

function RemoveButton({ compact, onRemove }: { compact: boolean; onRemove: () => void }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove file"
        className="text-text-tertiary hover:text-text cursor-pointer p-1"
      >
        <XIcon className="size-3.5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onRemove}
      className="border-border text-text-tertiary hover:text-text inline-flex cursor-pointer items-center gap-1 rounded-sm border px-2 py-1.5 font-mono text-xs uppercase tracking-wider"
    >
      <XIcon className="size-3" /> remove
    </button>
  );
}

function DownloadButton({ label, onDownload }: { label: string; onDownload: () => void }) {
  return (
    <button
      type="button"
      onClick={onDownload}
      className="border-border-strong text-text hover:bg-surface-sunken inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider"
    >
      <ArrowDownToLineIcon className="size-3" /> {label}
    </button>
  );
}

export function DefaultFileActions({
  canPreview,
  loadingPreview,
  expanded,
  onPreview,
  compact,
  onRemove,
  onDownload,
  downloadLabel,
}: {
  canPreview: boolean;
  loadingPreview: boolean;
  expanded: boolean;
  onPreview: () => Promise<void>;
  compact: boolean;
  onRemove?: () => void;
  onDownload?: () => void;
  downloadLabel: string;
}) {
  return (
    <>
      {canPreview && (
        <PreviewToggleButton loading={loadingPreview} expanded={expanded} onClick={onPreview} />
      )}
      {onRemove ? (
        <RemoveButton compact={compact} onRemove={onRemove} />
      ) : onDownload ? (
        <DownloadButton label={downloadLabel} onDownload={onDownload} />
      ) : null}
    </>
  );
}

export function InlinePreviewPanel({
  expanded,
  previewUrl,
  fileName,
  mimeType,
  features,
}: {
  expanded: boolean;
  previewUrl: string | null;
  fileName: string;
  mimeType: string | null;
  features?: MediaPreviewFeatures;
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-200 ease-out",
        expanded && previewUrl ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">
        <div className="border-border border-t p-4">
          {previewUrl && (
            <MediaPreview
              fileName={fileName}
              mimeType={mimeType}
              previewUrl={previewUrl}
              features={features}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function FilePreviewModal({
  url,
  fileName,
  mimeType,
  open,
  onOpenChange,
  onDownload,
}: {
  url: string;
  fileName: string;
  mimeType: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload?: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <ModalPreview
        url={url}
        fileName={fileName}
        mimeType={mimeType}
        open={open}
        onOpenChange={onOpenChange}
        onDownload={onDownload}
      />
    </Suspense>
  );
}
