/**
 * Draft preview panel (RFC-0001 D14, exec-plan 0004 T23). Renders the current
 * editor draft as the public presentation would show it, inside a hidden-named
 * iframe pointed at Site's `/__preview` route. The public brand composition is
 * NOT reimplemented here (INV-OP-2 / INV-SITE-1): Operator holds no SITE binding
 * and Site holds no draft-read binding, so the draft travels in a POST body
 * authenticated by an HMAC only the Access-protected Operator can mint
 * (`signPreview`). Refresh is on-demand (a button), never per keystroke.
 */
import { useRef, useState } from "react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { signPreview } from "@/lib/preview.functions";
import type { PreviewPayload } from "@/lib/preview";

const FRAME_NAME = "si-operator-preview";
const SITE_PREVIEW_URL = import.meta.env.SITE_PREVIEW_URL as string | undefined;

export function PreviewPanel({
  getPayload,
  disabled = false,
}: {
  // Reads the CURRENT form state at refresh time (not a re-fetch). Returns null
  // when there is nothing previewable yet (e.g. an uncreated page).
  getPayload: () => PreviewPayload | null;
  disabled?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const payloadRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);
  const expiresRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const configured = typeof SITE_PREVIEW_URL === "string" && SITE_PREVIEW_URL.length > 0;

  async function refresh(): Promise<void> {
    setError(null);
    const payload = getPayload();
    if (!payload) {
      setError("Nothing to preview yet — save a draft first.");
      return;
    }
    setBusy(true);
    try {
      const signed = await signPreview({ data: payload });
      if (payloadRef.current) payloadRef.current.value = signed.payloadJson;
      if (signatureRef.current) signatureRef.current.value = signed.signature;
      if (expiresRef.current) expiresRef.current.value = String(signed.expiresAt);
      formRef.current?.submit();
      setShown(true);
    } catch {
      setError("Couldn't sign the preview. Reload and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="soft" className="mb-6 p-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-foreground font-semibold">Preview</h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            The public presentation of the current draft — not yet published.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void refresh()}
          disabled={busy || disabled || !configured}
        >
          {busy ? "Rendering…" : shown ? "Refresh preview" : "Show preview"}
        </Button>
      </div>

      {!configured && (
        <p className="text-destructive font-mono text-xs">SITE_PREVIEW_URL is not configured.</p>
      )}
      {error && <p className="text-destructive font-mono text-xs">{error}</p>}

      {/* Hidden form posts the signed draft into the named iframe cross-origin. */}
      <form ref={formRef} method="POST" action={SITE_PREVIEW_URL} target={FRAME_NAME} hidden>
        <input ref={payloadRef} type="hidden" name="payload" />
        <input ref={signatureRef} type="hidden" name="signature" />
        <input ref={expiresRef} type="hidden" name="expiresAt" />
      </form>

      <iframe
        name={FRAME_NAME}
        title="Draft preview"
        className="border-border bg-background h-[640px] w-full rounded-sm border"
        style={{ display: shown ? "block" : "none" }}
      />
    </Card>
  );
}
