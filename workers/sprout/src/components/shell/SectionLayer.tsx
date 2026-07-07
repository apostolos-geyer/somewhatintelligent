import { X } from "lucide-react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogFullScreenContent,
  DialogTitle,
} from "@greenroom/ui/components/dialog";
import { SECTION_META, type SectionKey } from "@/lib/sections";

/**
 * The full-screen section overlay, backed by the Base UI `Dialog` primitive so it
 * gets focus-trap, Escape-to-close, focus restoration, `aria-modal`, and
 * scroll-lock for free (the previous hand-rolled overlay had none of those). It's
 * a CONTROLLED dialog: open is implied by this component being mounted (the layer
 * is driven by the `?section=` URL param in `LayerStack`), and any close intent
 * (Escape / backdrop / the X) routes through `onClose` → `closeLayer`, which drops
 * the search param and unmounts this — so "close restores the grid at its exact
 * scroll" still holds. The body is the section's own component.
 */
export function SectionLayer({
  section,
  title,
  onClose,
  children,
}: {
  section: SectionKey;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = title ?? SECTION_META[section].title;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogFullScreenContent>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-page py-4">
          <DialogTitle className="min-w-0 truncate font-display text-xl font-bold">
            {heading}
          </DialogTitle>
          <DialogClose
            aria-label="Close section"
            render={
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <X className="size-5" aria-hidden />
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-page">{children}</div>
      </DialogFullScreenContent>
    </Dialog>
  );
}
