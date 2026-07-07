import { useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Field, FieldError, FieldLabel } from "@greenroom/ui/components/field";
import { cn } from "@greenroom/ui/lib/utils";
import { upsertMyReview, type ReviewView } from "@/lib/reviews.functions";
import { StarRating } from "./StarRating";

const MAX_BODY = 300;

/**
 * Validation for the budtender's own review. `rating` is the integer 1..5 the
 * server (and the CHECK) re-enforce; `body` is bounded to 300 chars. The store is
 * a free-form self-declared snapshot. These bounds mirror the server validator —
 * UX guardrails, not the security boundary.
 */
const reviewSchema = type({
  rating: "1 <= number.integer <= 5",
  body: `string <= ${MAX_BODY}`,
  store: "string <= 120",
});

/**
 * The budtender's own-review composer (lives inside ReviewsBlock). ONE `useAppForm`
 * holding the StarRating field + a 300-char-counted body + an optional store. When
 * the caller already has a review it pre-fills, and submitting REPLACES it in place
 * (the server's ON CONFLICT upsert). The submit is optimistic: the parent's
 * `onSaved(next)` immediately swaps the user's prior review for the new shape, then
 * reconciles against the server list. A failure surfaces inline and the optimistic
 * row is rolled back by the parent's refetch.
 *
 * Star rating isn't one of the kit's registered field kinds, so it's wired by hand
 * via `form.AppField`'s render prop (like ColorField) while keeping the form value
 * the source of truth.
 */
export function ReviewComposer({
  productId,
  mine,
  onSaved,
}: {
  productId: string;
  /** The caller's existing review, if any — pre-fills + flags "replace" mode. */
  mine: ReviewView | null;
  /** Called after a successful save with the optimistic next review shape. */
  onSaved: (next: { rating: number; body: string; store: string | null }) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: {
      rating: mine?.rating ?? 0,
      body: mine?.body ?? "",
      store: mine?.store ?? "",
    },
    validators: { onBlur: reviewSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      if (value.rating < 1) {
        setError("Pick a star rating first.");
        return;
      }
      const store = value.store.trim() || null;
      // Optimistic: hand the parent the new shape immediately.
      onSaved({ rating: value.rating, body: value.body, store });
      try {
        await upsertMyReview({
          data: {
            productId,
            rating: value.rating,
            body: value.body,
            ...(store ? { store } : {}),
          },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your review.");
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm font-semibold">{mine ? "Edit your review" : "Leave a review"}</p>

      <form.AppField name="rating">
        {(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid || undefined}>
              <FieldLabel>Your rating</FieldLabel>
              <StarRating
                value={field.state.value}
                onChange={(n) => field.handleChange(n)}
                label="Your rating"
                size={28}
              />
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          );
        }}
      </form.AppField>

      <form.AppField name="body">
        {(field) => {
          const remaining = MAX_BODY - field.state.value.length;
          return (
            <field.TextareaField
              label="What did you think?"
              placeholder="How does it sell, who's it for, how does it taste…"
              rows={3}
              description={`${remaining} character${remaining === 1 ? "" : "s"} left`}
              inputClassName={cn(remaining < 0 && "border-destructive")}
            />
          );
        }}
      </form.AppField>

      <form.AppField name="store">
        {(field) => (
          <field.TextField
            label="Store"
            placeholder="Your store (optional)"
            description="Shown alongside your name on the review."
          />
        )}
      </form.AppField>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <form.AppForm>
          <form.SubmitButton
            label={mine ? "Update review" : "Post review"}
            loadingLabel="Saving…"
          />
        </form.AppForm>
      </div>
    </form>
  );
}
