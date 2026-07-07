import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, Check, FileText, Loader2, ShieldX, UserRound } from "lucide-react";
import { Card, CardContent } from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  listPendingCredentials,
  reviewCredential,
  type PendingCredential,
} from "@/lib/credentials.functions";
import { fmtUtcDate } from "@/lib/dates";

/**
 * Sprout-Admin CanSell review queue (Idea 1). Nests under the `sprout-admin.tsx`
 * god-mode guard; the server fns enforce `requireAdminMiddleware` independently.
 * The loader fetches every PENDING submission across all users (the cert is
 * PLATFORM-WIDE per person, NOT per tenant — intentionally brand-unscoped behind
 * the platform-admin gate). Each row shows the submitter, the cert number +
 * expiry, and a link to the uploaded certificate, with Verify / Reject (note)
 * actions calling `reviewCredential`. After a decision the loader is invalidated
 * so the row drops out of the queue.
 */
export const Route = createFileRoute("/sprout-admin/credentials")({
  loader: async () => ({ pending: await listPendingCredentials() }),
  component: CredentialReviewQueue,
});

function CredentialReviewQueue() {
  const { pending } = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <BadgeCheck className="size-6 text-primary" aria-hidden />
          CanSell review
        </h1>
        <p className="text-sm text-muted-foreground">
          Budtenders upload their CanSell certificate; you confirm it. A verified cert is
          platform-wide for that person — not tied to one brand.
        </p>
      </header>

      {pending.length === 0 ? (
        <Card className={cn(surfaceMaterials.brutal)}>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BadgeCheck className="size-10 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-lg font-bold">Queue is clear</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              No CanSell submissions are waiting for review.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {pending.map((cred) => (
            <li key={cred.userId}>
              <ReviewRow cred={cred} onDecided={() => void router.invalidate()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({ cred, onDecided }: { cred: PendingCredential; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "verified" | "rejected">(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "verified" | "rejected") {
    setError(null);
    setBusy(decision);
    try {
      await reviewCredential({
        data: {
          userId: cred.userId,
          decision,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the decision. Try again.");
      setBusy(null);
    }
  }

  return (
    <Card className={cn("flex flex-col gap-4 p-5", surfaceMaterials.brutal)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <UserRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{cred.submitterName}</p>
            <p className="font-mono text-xs text-muted-foreground">{cred.userId}</p>
          </div>
        </div>
        <Badge variant="info">Pending</Badge>
      </div>

      <dl className="grid gap-3 pl-8 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Cert number</dt>
          <dd className="font-mono">{cred.credentialNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Expires</dt>
          <dd>{fmtUtcDate(cred.expiresAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Submitted</dt>
          <dd>{fmtUtcDate(cred.submittedAt)}</dd>
        </div>
      </dl>

      <div className="pl-8">
        {cred.proofUrl ? (
          <a
            href={cred.proofUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-fit items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
          >
            <FileText className="size-4" aria-hidden />
            View uploaded certificate
          </a>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <FileText className="size-4" aria-hidden />
            {cred.hasProof ? "Certificate on file (preview needs R2)." : "No file uploaded."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 pl-8">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={`note-${cred.userId}`}
        >
          Review note <span className="font-normal">(optional — shown to the budtender)</span>
        </label>
        <input
          id={`note-${cred.userId}`}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. number doesn't match the certificate"
          className="rounded-sm border border-border bg-card px-2 py-1.5 text-sm"
        />
      </div>

      {error && <p className="pl-8 text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pl-8">
        <Button
          type="button"
          size="sm"
          variant="strong"
          disabled={busy !== null}
          onClick={() => void decide("verified")}
        >
          {busy === "verified" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          Verify
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void decide("rejected")}
        >
          {busy === "rejected" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ShieldX className="size-4" aria-hidden />
          )}
          Reject
        </Button>
      </div>
    </Card>
  );
}
