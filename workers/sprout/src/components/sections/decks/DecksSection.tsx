import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, Loader2 } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Card } from "@greenroom/ui/components/card";
import { FileIcon } from "@greenroom/ui/components/file-icon";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { usePortalContext } from "@/components/shell/portal-context";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import {
  getDeckCoverUrl,
  getDeckReadUrl,
  listDecks,
  recordDeckDownload,
  type DeckView,
} from "@/lib/decks.functions";
import { DeckFlipViewer } from "./DeckFlipViewer";

/** Friendly date for the deck card footer; 0/null collapses to a dash. */
function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The PK-Decks library (section 02) — rendered full-screen inside the
 * SectionLayer via the registry, so it takes no props. It reads the active brand
 * from the portal route context and its deep-link target from
 * `useLayerStack().item`: an `?item=<deckId>` deep-links straight into the
 * flip-viewer.
 *
 * The grid is a simple card grid (Card + surfaceMaterials). Each card shows the
 * deck's cover (the page-1 thumbnail once the `deck.derive` job lands; a
 * "processing" placeholder while `pageCount === 0`), its title, product line,
 * page count, and date. Clicking an in-platform-rendered deck opens the
 * `DeckFlipViewer`; a still-processing deck is inert (no PDF to flip yet).
 * Loading → Skeleton; empty → a quiet empty state.
 */
export function DecksSection() {
  const { brand } = usePortalContext();
  const { item, setItem } = useLayerStack();

  const [decks, setDecks] = useState<DeckView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDecks(null);
    void (async () => {
      try {
        const rows = await listDecks();
        if (!cancelled) setDecks(rows);
      } catch {
        if (!cancelled) setDecks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand?.orgId]);

  // The deep-linked / opened deck, resolved against the loaded list. A deck
  // that's still processing (page_count 0) can't be flipped, so it never opens.
  const openDeck = useMemo(
    () => (item ? (decks?.find((d) => d.id === item && d.pageCount > 0) ?? null) : null),
    [item, decks],
  );

  async function onDownload(deck: DeckView) {
    try {
      const res = await recordDeckDownload({ data: { deckId: deck.id } });
      if (!res.allowed) return; // server gate: download not allowed for this deck
      const url = await getDeckReadUrl({ data: { deckId: deck.id } });
      if (url.url) window.open(url.url, "_blank", "noopener,noreferrer");
    } catch {
      // roadie inert / failed — the event still recorded; nothing to open.
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (decks === null) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-grid sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-56 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (decks.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <BookOpen className="size-10 text-muted-foreground" aria-hidden />
        <h3 className="font-display text-lg font-bold">No decks yet</h3>
        <p className="text-sm text-muted-foreground">
          When {brand?.name ?? "the brand"} publishes product-knowledge decks, you'll be able to
          flip through them here.
        </p>
      </div>
    );
  }

  // ── Library ──────────────────────────────────────────────────────────────
  return (
    <>
      <div className="mx-auto max-w-5xl">
        <div role="list" className="grid grid-cols-1 gap-grid sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => {
            const processing = deck.pageCount === 0;
            return (
              <Card
                key={deck.id}
                role="listitem"
                className={cn(
                  "flex flex-col overflow-hidden p-0",
                  surfaceMaterials.brutal,
                  processing ? "cursor-default" : "cursor-pointer",
                )}
                onClick={() => {
                  if (!processing) setItem(deck.id);
                }}
              >
                <DeckCover deck={deck} processing={processing} />
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <p className="truncate font-medium" title={deck.title}>
                    {deck.title}
                  </p>
                  {deck.productLine && (
                    <p className="truncate text-xs text-muted-foreground">{deck.productLine}</p>
                  )}
                  <p className="mt-auto pt-2 text-xs text-muted-foreground">
                    {processing ? "Processing…" : `${deck.pageCount} pages`} ·{" "}
                    {formatDate(deck.publishedAt ?? deck.createdAt)}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {openDeck && (
        <DeckFlipViewer
          deck={openDeck}
          onClose={() => setItem(undefined)}
          onDownload={() => void onDownload(openDeck)}
        />
      )}
    </>
  );
}

/**
 * The deck card's cover band. Once the page-1 thumbnail is derived we render it
 * as an `<img>` (the read URL needs roadie, so it degrades to the generic
 * `FileIcon` glyph in local dev / before the thumbnail lands); while the deck is
 * still processing we show a clear "processing" placeholder so the admin knows
 * the derive job hasn't landed yet.
 */
function DeckCover({ deck, processing }: { deck: DeckView; processing: boolean }) {
  // Fetch the signed thumbnail URL only when a derived cover ref exists and the
  // deck has finished processing. roadie inert (local dev) → null URL → glyph.
  const hasThumb = !processing && deck.coverThumbRef !== null;
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setThumbUrl(null);
    setThumbFailed(false);
    if (!hasThumb) return;
    void (async () => {
      try {
        const res = await getDeckCoverUrl({ data: { deckId: deck.id } });
        if (!cancelled) setThumbUrl(res.url);
      } catch {
        if (!cancelled) setThumbUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deck.id, hasThumb]);

  const showImage = hasThumb && thumbUrl !== null && !thumbFailed;

  return (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-border bg-muted/40">
      {processing ? (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="size-7 animate-spin" aria-hidden />
          <span className="text-xs">Processing</span>
        </div>
      ) : showImage ? (
        <img
          src={thumbUrl}
          alt={`${deck.title} cover`}
          className="size-full object-cover"
          onError={() => setThumbFailed(true)}
        />
      ) : (
        // No derived thumbnail (queue lag) or roadie inert — generic glyph.
        <FileIcon mimeType="application/pdf" className="size-12 text-primary" />
      )}
      {processing ? (
        <Badge variant="outline" className="absolute right-2 top-2">
          Processing
        </Badge>
      ) : (
        <Badge variant="sprout-glass" className="absolute right-2 top-2">
          <FileText className="size-3" aria-hidden />
          PDF
        </Badge>
      )}
    </div>
  );
}
