import { useId } from "react";
import { Star } from "lucide-react";
import { cn } from "@greenroom/ui/lib/utils";

/**
 * A 1–5 star rating control with two modes:
 *
 *  - `readOnly` (the default when no `onChange` is given) → a static, decorative
 *    display of `value` (e.g. on a review row or a product's average). It renders
 *    as plain (aria-hidden) glyphs with an accessible text label alongside.
 *  - interactive (an `onChange` is passed) → a keyboard-operable radiogroup. Each
 *    star is a `role="radio"`; arrow keys move the selection (Left/Down decrement,
 *    Right/Up increment, Home/End jump to 1/5), matching the WAI-ARIA radiogroup
 *    pattern. Roving tabindex keeps a single tab stop. Works as a standalone
 *    control and as the inner control of a `useAppForm` field (see ReviewComposer).
 *
 * Half-stars aren't supported — ratings are integers 1..5 (the schema CHECK).
 */
export function StarRating({
  value,
  onChange,
  readOnly,
  size = 20,
  label = "Rating",
  className,
}: {
  /** Current rating, 0 (unset) … 5. */
  value: number;
  /** Provide to make the control interactive; omit for a static display. */
  onChange?: (next: number) => void;
  /** Force read-only even if an `onChange` is present. */
  readOnly?: boolean;
  size?: number;
  label?: string;
  className?: string;
}) {
  const groupId = useId();
  const interactive = !!onChange && !readOnly;
  const stars = [1, 2, 3, 4, 5] as const;

  // ── Read-only display ──────────────────────────────────────────────────────
  if (!interactive) {
    return (
      <span
        className={cn("inline-flex items-center gap-0.5", className)}
        role="img"
        aria-label={`${label}: ${value} out of 5`}
      >
        {stars.map((n) => (
          <Star
            key={n}
            aria-hidden
            style={{ width: size, height: size }}
            className={cn(
              "shrink-0",
              n <= value ? "fill-pistil text-pistil" : "fill-transparent text-muted-foreground/40",
            )}
          />
        ))}
      </span>
    );
  }

  // ── Interactive radiogroup ─────────────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    let next = value;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(5, value + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(1, value - 1);
    else if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 5;
    else return;
    e.preventDefault();
    onChange!(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5", className)}
      onKeyDown={onKeyDown}
    >
      {stars.map((n) => {
        const checked = n === value;
        // Roving tabindex: the selected star (or the first, when unset) is the
        // single tab stop; arrow keys move within the group.
        const tabbable = checked || (value === 0 && n === 1);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            id={`${groupId}-${n}`}
            aria-checked={checked}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onChange!(n)}
            className="flex shrink-0 items-center justify-center rounded-sm p-0.5 text-pistil outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              aria-hidden
              style={{ width: size, height: size }}
              className={cn(
                n <= value
                  ? "fill-pistil text-pistil"
                  : "fill-transparent text-muted-foreground/40",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
