/**
 * The two-step hard-delete contract (RFC-0001 D8). Every destructive command
 * first returns a `DeletionPlan` with an impact summary and a short-lived
 * `confirmationToken` bound to the operator, action, target, and current
 * revision; execution consumes that token and is idempotent. Transcribed from
 * RFC-0001 "Shared operator call contract".
 */
export interface DeletionImpact {
  targetType:
    | "product"
    | "product_release"
    | "text"
    | "text_release"
    | "software"
    | "product_variant"
    | "page"
    | "page_release"
    | "tag"
    | "media";
  targetId: string;
  label: string;
  activeReleaseAffected: boolean;
  deleteCounts: Record<string, number>;
  retainedCounts: Record<string, number>;
  warnings: string[];
}

export interface DeletionPlan {
  impact: DeletionImpact;
  confirmationToken: string;
  expiresAt: number;
}

export interface ConfirmDeletionInput {
  confirmationToken: string;
}

export type DeletionError =
  | "not_found"
  | "deletion_plan_expired"
  | "deletion_plan_mismatch"
  | "deletion_already_executed";
