import { FileText, Video } from "lucide-react";

const config = {
  video: { icon: Video, label: "Video preview" },
  document: { icon: FileText, label: "Document preview" },
} as const;

export function ComingSoonPreview({ type }: { type: "video" | "document" }) {
  const { icon: Icon, label } = config[type];

  return (
    <div className="text-text-tertiary border-border flex items-center gap-3 rounded-sm border border-dashed p-4">
      <Icon className="size-5" />
      <span className="text-sm">{label}</span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-wider">coming soon</span>
    </div>
  );
}
