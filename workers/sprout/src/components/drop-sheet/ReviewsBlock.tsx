import { useEffect, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import {
  deleteMyReview,
  listReviews,
  type ReviewSummary,
  type ReviewView,
} from "@/lib/reviews.functions";
import { StarRating } from "./StarRating";
import { ReviewComposer } from "./ReviewComposer";

/** Relative-ish timestamp; falls back to a locale date for older rows. */
function formatWhen(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < day) return "Today";
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * The product-detail reviews block: an average summary, the budtender's own
 * composer (create / replace their single review), and every other review on the
 * product within the brand. Loads via the gated `listReviews` in a useEffect (the
 * detail is client-mounted, not a route loader). Deletes are HARD — the author's
 * own "Delete" calls `deleteMyReview` (real DELETE; no hide). The whole block
 * scopes to the caller's brand server-side.
 */
export function ReviewsBlock({ productId }: { productId: string }) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);

  async function refresh() {
    try {
      setSummary(await listReviews({ data: { productId } }));
    } catch {
      setSummary({ reviews: [], count: 0, average: null, mine: null });
    }
  }

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    void (async () => {
      try {
        const res = await listReviews({ data: { productId } });
        if (!cancelled) setSummary(res);
      } catch {
        if (!cancelled) setSummary({ reviews: [], count: 0, average: null, mine: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Optimistic in-place swap of the caller's own review after a save.
  function onSavedMine(next: { rating: number; body: string; store: string | null }) {
    setSummary((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      const existing = prev.mine;
      const nextMine: ReviewView = {
        id: existing?.id ?? `optimistic:${now}`,
        userId: existing?.userId ?? "me",
        authorName: existing?.authorName ?? "You",
        store: next.store,
        rating: next.rating,
        body: next.body,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        mine: true,
      };
      const others = prev.reviews.filter((r) => !r.mine);
      const reviews = [nextMine, ...others];
      const count = reviews.length;
      const average = reviews.reduce((acc, r) => acc + r.rating, 0) / count;
      return { reviews, count, average, mine: nextMine };
    });
    // Reconcile against the server (picks up the real id + canonical ordering).
    void refresh();
  }

  async function onDeleteMine() {
    // Optimistic removal of the caller's own review.
    setSummary((prev) => {
      if (!prev) return prev;
      const reviews = prev.reviews.filter((r) => !r.mine);
      const count = reviews.length;
      const average = count > 0 ? reviews.reduce((acc, r) => acc + r.rating, 0) / count : null;
      return { reviews, count, average, mine: null };
    });
    try {
      await deleteMyReview({ data: { productId } });
    } finally {
      void refresh();
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (summary === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-28 w-full rounded-sm" />
        <Skeleton className="h-16 w-full rounded-sm" />
      </div>
    );
  }

  const others = summary.reviews.filter((r) => !r.mine);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Reviews
        </h4>
        {summary.average != null && (
          <div className="flex items-center gap-2">
            <StarRating
              value={Math.round(summary.average)}
              readOnly
              size={16}
              label="Average rating"
            />
            <span className="text-sm text-muted-foreground">
              {summary.average.toFixed(1)} · {summary.count} review{summary.count === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>

      <ReviewComposer productId={productId} mine={summary.mine} onSaved={onSavedMine} />

      {summary.mine && <ReviewRow review={summary.mine} onDelete={() => void onDeleteMine()} />}

      {others.length > 0 && (
        <ul className="space-y-3">
          {others.map((review) => (
            <li key={review.id}>
              <ReviewRow review={review} />
            </li>
          ))}
        </ul>
      )}

      {summary.count === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
          <MessageSquare className="size-6" aria-hidden />
          <p className="text-sm">No reviews yet. Be the first.</p>
        </div>
      )}
    </div>
  );
}

/** One review row. The author's own row (when `onDelete` is given) shows a hard-
 * delete control; all other rows are read-only (admins delete from the admin
 * surface — never here). */
function ReviewRow({ review, onDelete }: { review: ReviewView; onDelete?: () => void }) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card p-3",
        review.mine && "border-primary/30 bg-primary/5",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{review.authorName}</p>
            {review.mine && <span className="text-xs text-muted-foreground">(you)</span>}
          </div>
          {review.store && <p className="truncate text-xs text-muted-foreground">{review.store}</p>}
        </div>
        <StarRating value={review.rating} readOnly size={16} />
      </div>
      {review.body && <p className="mt-2 text-sm text-foreground">{review.body}</p>}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{formatWhen(review.updatedAt)}</span>
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDelete}
            aria-label="Delete your review"
          >
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
