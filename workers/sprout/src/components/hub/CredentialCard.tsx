import { useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  getMyCredential,
  registerCredentialUpload,
  submitCredential,
  type MyCredential,
} from "@/lib/credentials.functions";
import type { CredentialState } from "@/lib/credentials";
import { fmtUtcDate } from "@/lib/dates";
import { sha256Hex } from "@/lib/files";

/** UTC YYYY-MM-DD for an `<input type="date">` default — UTC (not local) getters
 * so the server and client seed the controlled `expiry` with the same value. */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * The CanSell SOFT PROMPT on the Hub (Idea 1 — "log in for budtenders, verify with
 * a valid CanSell"). Status-driven, never a hard block: it nudges the budtender to
 * add / renew / await-review their platform-wide CanSell certificate. The card is
 * controlled by the credential's DERIVED state (from `getMyCredential`):
 *
 *   missing  → amber "Add your CanSell" + the upload form
 *   pending  → "Under review" (a submission is in the admin queue)
 *   valid    → green check + number + "Expires <date>" + an Update affordance
 *   expired  → warn "expired" + re-submit form
 *   rejected → warn + the admin's review note + re-submit form
 *
 * The upload mirrors `ProofConfirm`: register → PUT (when roadie live) → submit;
 * degrades to a file-less submission when roadie is inert (local dev). It owns its
 * own refresh after a submit so the card reflects the new `pending` immediately.
 */
export function CredentialCard({ credential }: { credential: MyCredential | null }) {
  const [cred, setCred] = useState<MyCredential | null>(credential);
  const [editing, setEditing] = useState(false);

  const state: CredentialState = cred?.state ?? "missing";

  async function refresh() {
    try {
      setCred(await getMyCredential());
    } catch {
      // keep the current view on a transient read failure
    }
  }

  return (
    <Card className={cn("flex flex-col gap-4 p-5", surfaceMaterials.brutal)}>
      <Header state={state} />

      {/* ── Status body ─────────────────────────────────────────────────── */}
      {state === "valid" && cred && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 shrink-0 text-growth-700" aria-hidden />
            <span className="font-medium">Your CanSell is verified.</span>
          </p>
          <p className="pl-6 text-sm text-muted-foreground">
            {cred.credentialNumber ? (
              <>
                Cert <span className="font-mono text-foreground">{cred.credentialNumber}</span>{" "}
                ·{" "}
              </>
            ) : null}
            Expires{" "}
            <time dateTime={new Date(cred.expiresAt).toISOString()} className="text-foreground">
              {fmtUtcDate(cred.expiresAt)}
            </time>
          </p>
          {cred.proofUrl && (
            <a
              href={cred.proofUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-1.5 pl-6 text-xs text-primary underline-offset-2 hover:underline"
            >
              <FileText className="size-3.5" aria-hidden />
              View certificate
            </a>
          )}
          {!editing && (
            <div className="pl-6 pt-1">
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                Update CanSell
              </Button>
            </div>
          )}
        </div>
      )}

      {state === "pending" && cred && (
        <p className="flex items-center gap-2 pl-0.5 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0 text-primary" aria-hidden />
          Your CanSell is under review. We&apos;ll mark it verified once an admin confirms it
          {cred.credentialNumber ? (
            <>
              {" "}
              (cert <span className="font-mono text-foreground">{cred.credentialNumber}</span>)
            </>
          ) : null}
          .
        </p>
      )}

      {state === "missing" && (
        <p className="text-sm text-muted-foreground">
          Add your CanSell to verify you can sell. Upload your certificate (PDF or photo) and an
          admin will confirm it.
        </p>
      )}

      {state === "expired" && (
        <p className="flex items-center gap-2 text-sm text-warning-ink">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          Your CanSell has expired. Re-upload a current certificate to stay verified.
        </p>
      )}

      {state === "rejected" && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm text-warning-ink">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            Your CanSell submission was rejected. Please re-submit.
          </p>
          {cred?.reviewNote && (
            <p className="pl-6 text-sm text-muted-foreground">
              Reviewer note: <span className="text-foreground">{cred.reviewNote}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Upload form ─────────────────────────────────────────────────── */}
      {(state === "missing" ||
        state === "expired" ||
        state === "rejected" ||
        (state === "valid" && editing)) && (
        <CredentialForm
          defaultExpiresAt={cred?.expiresAt}
          defaultNumber={cred?.credentialNumber ?? ""}
          onDone={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}
    </Card>
  );
}

const STATE_BADGE: Record<
  CredentialState,
  { variant: "warn" | "info" | "sprout" | "danger"; label: string }
> = {
  missing: { variant: "warn", label: "Action needed" },
  pending: { variant: "info", label: "Under review" },
  valid: { variant: "sprout", label: "Verified" },
  expired: { variant: "warn", label: "Expired" },
  rejected: { variant: "danger", label: "Rejected" },
};

function Header({ state }: { state: CredentialState }) {
  const badge = STATE_BADGE[state];
  return (
    <header className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
        <BadgeCheck className="size-5 text-primary" aria-hidden />
        Your CanSell
      </h2>
      <Badge variant={badge.variant}>{badge.label}</Badge>
    </header>
  );
}

/**
 * The upload + details form. File input (image/pdf) + optional cert number +
 * required expiry. On submit: register → PUT (when roadie returns an upload URL)
 * → submitCredential; degrades to a file-less submission when roadie is inert.
 */
function CredentialForm({
  defaultExpiresAt,
  defaultNumber,
  onDone,
}: {
  defaultExpiresAt: number | undefined;
  defaultNumber: string;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState(defaultNumber);
  const [expiry, setExpiry] = useState(defaultExpiresAt ? toDateInput(defaultExpiresAt) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    // End-of-day UTC so the stored instant round-trips with the UTC formatters
    // (fmtDate / toDateInput) — a local parse would drift the stored day by the
    // client's offset and read back off-by-one — and a cert "expiring" on date X
    // stays valid through X for our (all west-of-UTC) Canadian users instead of
    // lapsing at its local midnight.
    const expiresAt = expiry ? new Date(`${expiry}T23:59:59Z`).getTime() : NaN;
    if (!Number.isFinite(expiresAt)) {
      setError("Please enter the certificate's expiry date.");
      return;
    }
    if (expiresAt <= Date.now()) {
      setError("That expiry date is in the past — enter the certificate's future expiry.");
      return;
    }
    setBusy(true);
    try {
      let referenceId: string | undefined;
      if (file) {
        const ok = file.type.startsWith("image/") || file.type === "application/pdf";
        if (!ok) throw new Error("Please choose an image or PDF.");
        const hash = await sha256Hex(file);
        const reg = await registerCredentialUpload({
          data: { hash, size: file.size, contentType: file.type || "application/pdf" },
        });
        // Only thread the ref through if the bytes actually pushed (roadie live).
        if (reg.upload) {
          const put = await fetch(reg.upload.url, {
            method: "PUT",
            headers: reg.upload.headers,
            body: file,
          });
          if (put.ok) referenceId = reg.referenceId;
        }
      }
      await submitCredential({
        data: {
          expiresAt,
          ...(number.trim() ? { credentialNumber: number.trim() } : {}),
          ...(referenceId ? { referenceId } : {}),
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't submit. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-dashed border-border p-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="cansell-file">
          Certificate (PDF or photo)
        </label>
        <input
          id="cansell-file"
          type="file"
          accept="image/*,application/pdf"
          className="text-xs file:mr-2 file:rounded-sm file:border file:border-border file:bg-card file:px-2 file:py-1"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cansell-number">
            Cert number <span className="font-normal">(optional)</span>
          </label>
          <input
            id="cansell-number"
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. CS-12345"
            className="rounded-sm border border-border bg-card px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cansell-expiry">
            Expiry date
          </label>
          <input
            id="cansell-expiry"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded-sm border border-border bg-card px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="strong"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          Submit for review
        </Button>
        {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
      </div>
    </div>
  );
}
