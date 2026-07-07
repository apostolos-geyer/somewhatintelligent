import type { ReactNode } from "react";
import { cn } from "@greenroom/ui/lib/utils";

/**
 * A CSS-only two-faced 3D flip. The VISIBLE face is in normal flow (so it sets the
 * card's height); the away face is overlaid `absolute inset-0` (so it never inflates
 * the card). The card is therefore only ever as tall as the face you're looking at —
 * compact when collapsed, taller only once the sample is revealed — instead of
 * always sizing to the taller (hidden) face. The wrapper rotates 180° on `revealed`.
 * CSS-only on purpose — there's no animation library in the app (Tailwind v4 +
 * arbitrary props for the 3D bits).
 *
 * Notes:
 *  - perspective + preserve-3d live on a PLAIN wrapper, never a `Card` (Card is
 *    `overflow-hidden`, which clips the rotating child).
 *  - `backface-visibility:hidden` on both faces stops the away-face bleeding
 *    through (mirror text) during the 0–180° sweep.
 *  - `motion-reduce` drops the spin; the faces still swap instantly.
 *  - the hidden face is `inert` (React 19) so its buttons/links aren't tabbable
 *    or announced while flipped away.
 */
export function FlipPreviewCard({
  revealed,
  front,
  back,
  className,
}: {
  revealed: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("[perspective:1600px]", className)}>
      <div
        className={cn(
          "relative transition-transform duration-500 ease-out [transform-style:preserve-3d]",
          "motion-reduce:transition-none motion-reduce:duration-0",
          revealed && "[transform:rotateY(180deg)]",
        )}
      >
        <div
          className={cn("[backface-visibility:hidden]", revealed ? "absolute inset-0" : "relative")}
          inert={revealed}
          aria-hidden={revealed}
        >
          {front}
        </div>
        <div
          className={cn(
            "[transform:rotateY(180deg)] [backface-visibility:hidden]",
            revealed ? "relative" : "absolute inset-0",
          )}
          inert={!revealed}
          aria-hidden={!revealed}
        >
          {back}
        </div>
      </div>
    </div>
  );
}
