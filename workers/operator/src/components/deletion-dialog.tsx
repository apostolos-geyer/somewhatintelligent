"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { DeletionError, DeletionImpact, DeletionPlan, DomainResult } from "@si/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Badge } from "@si/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { Spinner } from "@si/ui/components/spinner";
import {
  DELETION_ERROR_COPY,
  confirmationSatisfied,
  deletionReducer,
  initialDeletionPhase,
  isReplannable,
} from "@/lib/deletion-machine";

type ConfirmResult = { deleted: true; activeVersion?: string | null };

export interface DeletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "Delete text". */
  title: string;
  /** Phrase the operator must type verbatim to arm the delete (e.g. the slug). */
  confirmPhrase: string;
  /** Plan the deletion — returns the impact + a short-lived confirmation token. */
  plan: () => Promise<DomainResult<DeletionPlan, string>>;
  /** Execute the deletion with the planned token; idempotent server-side. */
  confirm: (input: {
    confirmationToken: string;
  }) => Promise<DomainResult<ConfirmResult, DeletionError>>;
  onDeleted: (result: ConfirmResult) => void;
}

/**
 * The shared two-step hard-delete affordance (RFC-0001 D8): planning on open,
 * an impact summary, a typed-confirmation gate, then a token-bound execute. Each
 * `DeletionError` gets distinct copy; a stale plan (expired / drifted) offers a
 * re-plan. Drives the pure `deletion-machine` reducer.
 */
export function DeletionDialog({
  open,
  onOpenChange,
  title,
  confirmPhrase,
  plan,
  confirm,
  onDeleted,
}: DeletionDialogProps) {
  const [phase, dispatch] = useReducer(deletionReducer, initialDeletionPhase);
  const [typed, setTyped] = useState("");
  const [planNonce, setPlanNonce] = useState(0);
  const planRef = useRef(plan);
  planRef.current = plan;

  // (Re)plan whenever the dialog opens or a re-plan is requested. `plan` is read
  // through a ref so a fresh inline closure each render doesn't re-fire this.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTyped("");
    dispatch({ type: "plan_start" });
    planRef
      .current()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) dispatch({ type: "plan_ok", plan: res.value });
        else dispatch({ type: "plan_fail", message: res.error });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "plan_fail", message: "plan_failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, planNonce]);

  const armed =
    (phase.status === "ready" || phase.status === "confirm_error") &&
    confirmationSatisfied(typed, confirmPhrase);

  async function runConfirm(): Promise<void> {
    if (phase.status !== "ready" && phase.status !== "confirm_error") return;
    const token = phase.plan.confirmationToken;
    dispatch({ type: "confirm_start" });
    try {
      const res = await confirm({ confirmationToken: token });
      if (res.ok) {
        dispatch({ type: "confirm_ok", activeVersion: res.value.activeVersion });
        onDeleted(res.value);
        onOpenChange(false);
      } else {
        dispatch({ type: "confirm_fail", error: res.error });
      }
    } catch {
      // A transport failure is recoverable — re-planning mints a fresh token.
      dispatch({ type: "confirm_fail", error: "deletion_plan_mismatch" });
    }
  }

  const busy = phase.status === "planning" || phase.status === "confirming";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This permanently deletes the item and cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {phase.status === "planning" && (
          <div className="text-muted-foreground flex items-center gap-2 py-4 font-mono text-xs">
            <Spinner className="size-4" /> Assessing impact…
          </div>
        )}

        {phase.status === "plan_error" && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't plan the deletion</AlertTitle>
            <AlertDescription>
              {DELETION_ERROR_COPY[phase.message as DeletionError] ?? phase.message}
            </AlertDescription>
          </Alert>
        )}

        {(phase.status === "ready" ||
          phase.status === "confirming" ||
          phase.status === "confirm_error") && (
          <div className="grid gap-4">
            <ImpactSummary impact={phase.plan.impact} />

            {phase.status === "confirm_error" && (
              <Alert variant="destructive">
                <AlertTitle>Deletion failed</AlertTitle>
                <AlertDescription>{DELETION_ERROR_COPY[phase.error]}</AlertDescription>
              </Alert>
            )}

            {phase.status === "confirm_error" && isReplannable(phase.error) ? (
              <Button variant="outline" onClick={() => setPlanNonce((n) => n + 1)}>
                Re-plan
              </Button>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="delete-confirm">
                  Type <span className="text-foreground font-mono">{confirmPhrase}</span> to confirm
                </Label>
                <Input
                  id="delete-confirm"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={confirmPhrase}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!armed || busy} onClick={() => void runConfirm()}>
            {phase.status === "confirming" ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImpactSummary({ impact }: { impact: DeletionImpact }) {
  const deletes = Object.entries(impact.deleteCounts).filter(([, n]) => n > 0);
  const retained = Object.entries(impact.retainedCounts).filter(([, n]) => n > 0);
  return (
    <div className="border-border grid gap-3 rounded-sm border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-foreground font-semibold">{impact.label}</span>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {impact.targetType.replace(/_/g, " ")}
        </Badge>
      </div>

      {impact.activeReleaseAffected && (
        <p className="text-warning font-mono text-xs">This affects the live release.</p>
      )}

      {deletes.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wider">
            Deletes
          </p>
          <ul className="grid gap-0.5 font-mono text-xs">
            {deletes.map(([k, n]) => (
              <li key={k} className="text-foreground">
                {n} {k.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {retained.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wider">
            Retained
          </p>
          <ul className="text-muted-foreground grid gap-0.5 font-mono text-xs">
            {retained.map(([k, n]) => (
              <li key={k}>
                {n} {k.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {impact.warnings.length > 0 && (
        <ul className="grid gap-0.5">
          {impact.warnings.map((w) => (
            <li key={w} className="text-warning font-mono text-xs">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
