import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, MessageSquare, Trash2 } from "lucide-react";
import { buttonVariants } from "@greenroom/ui/components/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@greenroom/ui/components/alert-dialog";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { StarRating } from "@/components/drop-sheet/StarRating";
import { deleteReview, listAdminReviews, type AdminReviewView } from "@/lib/reviews.functions";

/**
 * Brand-Admin review moderation (P2.B). Nests under the pathless `admin.tsx`
 * guard — SELF-CONTAINED. The ONLY admin action on a review is HARD DELETE: there
 * is NO edit and NO hide affordance anywhere on this surface (compliance — removal
 * is a real DELETE, gated + audited server-side as "review.delete"). brand_id is
 * the envelope's activeOrgId, never sent. A confirm dialog guards each delete
 * because it's irreversible.
 */
export const Route = createFileRoute("/admin/reviews")({
  component: AdminReviewsPage,
});

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AdminReviewsPage() {
  const [reviews, setReviews] = useState<AdminReviewView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setReviews(await listAdminReviews());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reviews.");
      setReviews([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Every review budtenders have left across your products. You can delete a review, but
          reviews are never edited or hidden — removal is permanent.
        </p>
      </header>

      {error && (
        <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {reviews === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-sm" />
          ))}
        </div>
      )}

      {reviews !== null && reviews.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <MessageSquare className="size-8" aria-hidden />
          <p className="text-sm">No reviews yet.</p>
        </div>
      )}

      <ul className="space-y-3">
        {reviews?.map((review) => (
          <li key={review.id} className={cn("flex flex-col gap-2 p-4", surfaceMaterials.brutal)}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium" title={review.productName}>
                  {review.productName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {review.authorName}
                  {review.store ? ` · ${review.store}` : ""} · {formatWhen(review.createdAt)}
                </p>
              </div>
              <StarRating value={review.rating} readOnly size={16} />
            </div>
            {review.body && <p className="text-sm text-foreground">{review.body}</p>}
            <div className="flex justify-end">
              <DeleteReviewButton review={review} onDeleted={() => void refresh()} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeleteReviewButton({
  review,
  onDeleted,
}: {
  review: AdminReviewView;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    try {
      await deleteReview({ data: { reviewId: review.id } });
      onDeleted();
    } catch {
      setBusy(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={busy}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this review?</AlertDialogTitle>
          <AlertDialogDescription>
            {review.authorName}'s review of {review.productName} will be permanently deleted. This
            can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => void onDelete()}
          >
            Delete review
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
