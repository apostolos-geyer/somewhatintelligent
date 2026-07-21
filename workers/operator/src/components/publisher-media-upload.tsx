/**
 * Same-origin Publisher-media upload control (RFC-0001 D10 / T19). Shared by the
 * text / software / page editors: an image file + alt + free-form role that POSTs
 * `multipart/form-data` to the Access-protected `/_operator/media/publisher/...`
 * route (no CORS — Operator serves it). On 201 the parent refreshes its media
 * list via `onUploaded`; a JSON `{error}` body surfaces inline.
 */
import { useState } from "react";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import type { PublisherMediaDTO } from "@si/contracts";

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

const MESSAGES: Record<string, string> = {
  invalid_file: "Choose an image file.",
  invalid_role: "Enter a role (up to 40 characters).",
  invalid_size: "That file is empty or too large (100 MB max).",
  unsupported_type: "Use a JPEG, PNG, WebP, AVIF, or GIF image.",
  not_found: "This record no longer exists — reload.",
  storage_unavailable: "Storage is unavailable right now — try again.",
};

export function PublisherMediaUpload({
  ownerType,
  ownerId,
  defaultRole = "gallery",
  disabled = false,
  onUploaded,
}: {
  ownerType: "text" | "software" | "page";
  ownerId: string;
  defaultRole?: string;
  disabled?: boolean;
  onUploaded: (media: PublisherMediaDTO) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(): Promise<void> {
    setError(null);
    if (!file) {
      setError("invalid_file");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("alt", alt);
      fd.set("role", role);
      fd.set("commandId", crypto.randomUUID());
      const res = await fetch(
        `/_operator/media/publisher/${ownerType}/${encodeURIComponent(ownerId)}`,
        { method: "POST", body: fd },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `upload_failed_${res.status}`);
        return;
      }
      const media = (await res.json()) as PublisherMediaDTO;
      setFile(null);
      setAlt("");
      onUploaded(media);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="border-border grid gap-3 rounded-sm border border-dashed p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void upload();
      }}
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't upload</AlertTitle>
          <AlertDescription>{MESSAGES[error] ?? error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`m-file-${ownerType}`}>Image file</Label>
        <Input
          id={`m-file-${ownerType}`}
          type="file"
          accept={ACCEPT}
          disabled={disabled || busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`m-alt-${ownerType}`}>Alt text</Label>
          <Input
            id={`m-alt-${ownerType}`}
            value={alt}
            disabled={disabled || busy}
            onChange={(e) => setAlt(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`m-role-${ownerType}`}>Role</Label>
          <Input
            id={`m-role-${ownerType}`}
            value={role}
            disabled={disabled || busy}
            onChange={(e) => setRole(e.target.value)}
            placeholder="gallery"
          />
        </div>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={disabled || busy || !file}>
          {busy ? "Uploading…" : "Upload image"}
        </Button>
      </div>
    </form>
  );
}
