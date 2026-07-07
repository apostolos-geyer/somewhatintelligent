import { type ReactNode, type RefObject, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { sha256Hex } from "@/lib/files";

export type PresignedPut = { url: string; headers: Record<string, string> };

export type UploadOutcome = {
  /** "no-store": roadie inert (draft row saved, no bytes pushed) · "put-failed": PUT rejected (draft saved; retry). */
  kind: "done" | "no-store" | "put-failed";
  error: string | null;
};

/**
 * The roadie 2-step upload: hash the file, `register` it (caller creates the
 * draft row + presigned PUT), push the bytes straight to R2, then finalize.
 * A non-"done" outcome carries the admin-facing error to surface inline.
 */
export async function uploadViaPresignedPut({
  file,
  register,
  noStoreError,
  savedNoun,
}: {
  file: File;
  register: (
    hash: string,
  ) => Promise<{ put: PresignedPut | null; finalize: () => Promise<unknown> }>;
  noStoreError: string;
  /** Noun for the saved row in the retry message ("draft", "slide", …). */
  savedNoun: string;
}): Promise<UploadOutcome> {
  const hash = await sha256Hex(file);
  const { put, finalize } = await register(hash);
  if (!put) return { kind: "no-store", error: noStoreError };
  const res = await fetch(put.url, { method: "PUT", headers: put.headers, body: file });
  if (!res.ok) {
    return {
      kind: "put-failed",
      error: `Upload failed (${res.status}). The ${savedNoun} is saved; retry to publish.`,
    };
  }
  await finalize();
  return { kind: "done", error: null };
}

/** File / busy / error state shared by every upload form, plus the post-success reset. */
export function useUploadState() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function reset(formApi: { reset: () => void }) {
    formApi.reset();
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /**
   * Standard submit skeleton: guard busy, run the upload, surface its error (or a
   * thrown one) inline, and reset the form only on success. `onUploaded` also runs
   * on non-"done" outcomes — the draft row landed, so the list must refresh.
   */
  async function submitUpload({
    formApi,
    upload,
    onUploaded,
    onError,
  }: {
    formApi: { reset: () => void };
    upload: () => Promise<UploadOutcome>;
    onUploaded: () => void;
    onError?: (outcome: UploadOutcome) => void;
  }) {
    setBusy(true);
    try {
      const outcome = await upload();
      if (outcome.error) {
        setUploadError(outcome.error);
        onError?.(outcome);
        onUploaded();
        return;
      }
      reset(formApi);
      onUploaded();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return {
    fileInputRef,
    file,
    setFile,
    busy,
    uploadError,
    setUploadError,
    reset,
    submitUpload,
  };
}

export function UploadFileInput({
  label,
  accept,
  inputRef,
  onSelect,
  hint,
}: {
  label: string;
  accept?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSelect: (file: File | null) => void;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-sm file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
      />
      {hint}
    </div>
  );
}

export function UploadCardShell({
  title,
  description,
  onSubmit,
  error,
  busy,
  canSubmit,
  children,
}: {
  title: string;
  description: string;
  onSubmit: () => void;
  error: string | null;
  busy: boolean;
  canSubmit: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn("p-5", surfaceMaterials.brutal)}>
      <CardHeader className="p-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <UploadSubmitButton busy={busy} disabled={busy || !canSubmit} label="Upload" />
        </form>
      </CardContent>
    </Card>
  );
}

export function UploadSubmitButton({
  busy,
  disabled,
  label,
  variant = "default",
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  variant?: "default" | "strong";
}) {
  return (
    <Button type="submit" variant={variant} disabled={disabled} className="w-fit">
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Upload className="size-4" aria-hidden />
      )}
      {busy ? "Uploading…" : label}
    </Button>
  );
}
