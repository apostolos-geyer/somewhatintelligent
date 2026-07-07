import {
  File,
  FileAudio,
  FileVideo,
  FileImage,
  FileText,
  FileCode,
  FileArchive,
  FileSpreadsheet,
} from "lucide-react";

const iconMap: Record<string, typeof File> = {
  audio: FileAudio,
  video: FileVideo,
  image: FileImage,
  "application/pdf": FileText,
  "text/markdown": FileCode,
  "text/plain": FileText,
  "text/csv": FileSpreadsheet,
  "application/zip": FileArchive,
  "application/x-tar": FileArchive,
  "application/gzip": FileArchive,
  "application/x-rar-compressed": FileArchive,
};

export function FileIcon({ mimeType, className }: { mimeType: string | null; className?: string }) {
  const type = mimeType ?? "";
  const category = type.split("/")[0] ?? "";

  const Icon = iconMap[type] ?? iconMap[category] ?? File;

  return <Icon className={className} />;
}

export function isAudio(mimeType: string | null | undefined) {
  return mimeType?.startsWith("audio/") ?? false;
}

export function isVideo(mimeType: string | null | undefined) {
  return mimeType?.startsWith("video/") ?? false;
}

export function isImage(mimeType: string | null | undefined) {
  return mimeType?.startsWith("image/") ?? false;
}

export function isDocument(mimeType: string | null | undefined) {
  if (!mimeType) return false;
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export function inferMimeFromName(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    // audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    // video
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    // image
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    // docs
    pdf: "application/pdf",
    md: "text/markdown",
    txt: "text/plain",
    csv: "text/csv",
    // archives
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    rar: "application/x-rar-compressed",
  };
  return map[ext] ?? null;
}
