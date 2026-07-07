import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";

/**
 * A keyboard-first reorder primitive. Move-up / move-down buttons are the
 * MANDATORY a11y baseline — every reorder is achievable with the keyboard, no
 * pointer drag required (pointer drag via @dnd-kit is an OPTIONAL progressive
 * enhancement deliberately deferred to avoid a new dependency). Moving an item
 * rewrites the order to a contiguous 0..n-1 array and calls `onReorder` with the
 * new ordering; the parent owns the list state.
 *
 * Generic over the item type. Reusable for the section checklist and (later)
 * hero slides + banners. The list itself is `role="list"`; each row exposes its
 * reorder controls with explicit `aria-label`s referencing the item's label.
 */
export interface SortableListProps<T> {
  items: readonly T[];
  /** Stable key per item (React key + a11y identity). */
  getKey: (item: T) => string;
  /** Accessible label for an item, used in the move-button aria-labels. */
  getLabel: (item: T) => string;
  /** Render the row body (left of the move controls). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Called with the reordered array after a move. */
  onReorder: (next: T[]) => void;
  className?: string;
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function SortableList<T>({
  items,
  getKey,
  getLabel,
  renderItem,
  onReorder,
  className,
}: SortableListProps<T>) {
  return (
    <ul role="list" className={cn("flex flex-col gap-2", className)}>
      {items.map((item, index) => {
        const label = getLabel(item);
        return (
          <li
            key={getKey(item)}
            className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
          >
            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Move ${label} up`}
                disabled={index === 0}
                onClick={() => onReorder(move(items, index, index - 1))}
              >
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={`Move ${label} down`}
                disabled={index === items.length - 1}
                onClick={() => onReorder(move(items, index, index + 1))}
              >
                <ArrowDown className="size-4" aria-hidden />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
