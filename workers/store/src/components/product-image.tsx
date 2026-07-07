import { ShirtIcon } from "lucide-react";

// Renders a product image by Roadie reference id. Bytes are served through the
// /api/img/$refId route (302 → signed R2 URL). When no image (or Roadie is
// inert in local dev), falls back to a branded placeholder.
export function ProductImage({
  refId,
  alt,
  className,
}: {
  refId: string | null;
  alt: string;
  className?: string;
}) {
  if (!refId) {
    return (
      <div
        className={
          "bg-surface-sunken text-text-tertiary flex items-center justify-center " +
          (className ?? "")
        }
        aria-label={alt}
      >
        <ShirtIcon className="size-10 opacity-40" />
      </div>
    );
  }
  return (
    <img
      src={`/api/img/${encodeURIComponent(refId)}`}
      alt={alt}
      loading="lazy"
      className={"bg-surface-sunken object-cover " + (className ?? "")}
    />
  );
}
