"use client";

import { cn } from "@si/ui/lib/utils";
import { Item, ItemActions } from "./item";
import { inferMimeFromName, isAudio, isDocument, isImage, isVideo } from "./file-icon";
import type { MediaPreviewFeatures } from "./file-preview/media-preview";
import {
  DefaultFileActions,
  FileItemBody,
  FilePreviewModal,
  FileThumbnail,
  InlinePreviewPanel,
  useFilePreview,
} from "./file-item-parts";

const isPdf = (mimeType: string | null | undefined) => mimeType === "application/pdf";

export type FileItemFeatures = MediaPreviewFeatures & {
  image?: boolean;
  video?: boolean;
  pdf?: boolean;
};

export interface FileItemFile {
  name: string;
  size: string | number;
  mimeType?: string | null;
  ext?: string;
  thumbnailGradient?: string;
  kindColor?: string;
}

export interface FileItemProps {
  file: FileItemFile;
  compact?: boolean;
  showThumbnailGradient?: boolean;
  fetchPreviewUrl?: () => Promise<string>;
  features?: FileItemFeatures;
  onRemove?: () => void;
  onDownload?: () => void;
  /** Override the default "get" label on the download button — e.g. "decrypt"
   *  when the action triggers an in-browser decrypt before saving. */
  downloadLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

function formatSize(value: string | number): string {
  if (typeof value === "string") return value;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const v = value / 1024 ** i;
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function extFromName(name: string): string {
  return name.split(".").pop()?.toUpperCase() ?? "FILE";
}

function kindLabel(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  if (isAudio(mimeType)) return "AUDIO";
  if (isVideo(mimeType)) return "VIDEO";
  if (isImage(mimeType)) return "IMAGE";
  if (mimeType === "application/pdf") return "PDF";
  if (
    mimeType.startsWith("application/zip") ||
    mimeType.includes("tar") ||
    mimeType.includes("gzip")
  )
    return "ARCHIVE";
  if (mimeType.startsWith("text/")) return "DOC";
  return null;
}

function fileDisplayMeta(file: FileItemFile) {
  const mimeType = file.mimeType ?? inferMimeFromName(file.name);
  const ext = file.ext ?? extFromName(file.name);
  return { mimeType, ext, sizeText: formatSize(file.size), meta: kindLabel(mimeType) ?? ext };
}

function supportsModalPreview(mimeType: string | null, features: FileItemFeatures | undefined) {
  return (
    (features?.video !== false && isVideo(mimeType)) ||
    (features?.image !== false && isImage(mimeType)) ||
    (features?.pdf !== false && isPdf(mimeType))
  );
}

function supportsInlinePreview(mimeType: string | null, features: FileItemFeatures | undefined) {
  return (
    (features?.audio !== false && isAudio(mimeType)) ||
    (features?.document !== false && isDocument(mimeType) && !isPdf(mimeType))
  );
}

export function FileItem({
  file,
  compact = false,
  showThumbnailGradient = true,
  fetchPreviewUrl,
  features,
  onRemove,
  onDownload,
  downloadLabel = "get",
  actions,
  className,
}: FileItemProps) {
  const { mimeType, ext, sizeText, meta } = fileDisplayMeta(file);
  const canModalPreview = supportsModalPreview(mimeType, features);
  const canInlinePreview = supportsInlinePreview(mimeType, features);
  const canPreview = Boolean(fetchPreviewUrl) && (canModalPreview || canInlinePreview);
  const preview = useFilePreview({ fetchPreviewUrl, canModalPreview });

  return (
    <div
      data-slot="file-item"
      data-compact={compact ? "" : undefined}
      data-expanded={preview.expanded ? "" : undefined}
      className={cn(
        "bg-surface-raised border-border hover:border-border-strong rounded-md border transition-colors",
        className,
      )}
    >
      <Item
        variant="default"
        className={cn(
          "rounded-none border-none bg-transparent",
          compact ? "gap-3 p-2.5 pl-3.5" : "gap-4 p-4",
        )}
      >
        <FileThumbnail
          ext={ext}
          compact={compact}
          gradient={showThumbnailGradient ? file.thumbnailGradient : undefined}
          kindColor={file.kindColor}
        />
        <FileItemBody name={file.name} sizeText={sizeText} meta={meta} compact={compact} />
        <ItemActions>
          {actions ?? (
            <DefaultFileActions
              canPreview={canPreview}
              loadingPreview={preview.loadingPreview}
              expanded={preview.expanded}
              onPreview={preview.handlePreview}
              compact={compact}
              onRemove={onRemove}
              onDownload={onDownload}
              downloadLabel={downloadLabel}
            />
          )}
        </ItemActions>
      </Item>

      {canInlinePreview && fetchPreviewUrl && (
        <InlinePreviewPanel
          expanded={preview.expanded}
          previewUrl={preview.previewUrl}
          fileName={file.name}
          mimeType={mimeType}
          features={features}
        />
      )}

      {canModalPreview && preview.previewUrl && (
        <FilePreviewModal
          url={preview.previewUrl}
          fileName={file.name}
          mimeType={mimeType}
          open={preview.modalOpen}
          onOpenChange={preview.setModalOpen}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}
