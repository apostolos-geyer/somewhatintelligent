import {
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import { getDeckReadUrl, recordFlipDepth, type DeckView } from "@/lib/decks.functions";

interface DeckFlipViewerProps {
  deck: DeckView;
  onClose: () => void;
  /** Records the download (server gates on download_allowed) then opens the PDF. */
  onDownload: () => void;
}

// pdfjs's document/page proxies — structurally narrowed to what we touch so the
// viewer doesn't depend on pdfjs's full ambient types in the section bundle.
type PdfPage = {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; doc: PdfDoc; pages: number }
  | { phase: "unavailable" };

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
/** Debounce window for the flip-depth write — coalesces rapid paging. */
const FLIP_FLUSH_MS = 1200;
/** Minimum horizontal travel (px) for a touch drag to count as a page-swipe. */
const SWIPE_THRESHOLD_PX = 50;

/**
 * The full-screen PK-deck flip-viewer (section 02), mounted over the SectionLayer.
 * It fetches the inline roadie URL (`getDeckReadUrl` — which also emits the
 * `deck_open` event), loads the PDF with pdfjs-dist, and rasterises one page at a
 * time to a `<canvas>` on demand. Prev/next + a page indicator + a thumbnail
 * filmstrip navigate; arrow keys page; +/− and double-tap toggle zoom.
 *
 * Flip-depth is reported via `recordFlipDepth` (debounced, carrying the dwell
 * since the last flush) as the budtender advances — the analytics signal the
 * leaderboard reads. roadie is inert in local dev (no R2): a null URL degrades to
 * a "preview needs R2" note with a download fallback, never a broken frame.
 */
export function DeckFlipViewer({ deck, onClose, onDownload }: DeckFlipViewerProps) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Tracks the in-flight render so a fast flip cancels the prior page's paint.
  const renderTaskRef = useRef<{ cancel(): void } | null>(null);
  // Dwell accounting for the debounced flip-depth write.
  const lastFlipAtRef = useRef<number>(Date.now());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `page` for the unmount/close flush (the `[]`-dep cleanup effect can't
  // close over the latest render's `page`, so it reads it from this ref).
  const pageRef = useRef(page);
  pageRef.current = page;
  // Tracks the touch-start X for mobile swipe paging.
  const touchStartXRef = useRef<number | null>(null);

  const pages = state.phase === "ready" ? state.pages : (deck.pageCount ?? 0);

  // ── load the PDF (fetch inline URL → pdfjs getDocument) ────────────────────
  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setState({ phase: "loading" });
    setPage(1);
    lastFlipAtRef.current = Date.now();

    void (async () => {
      try {
        const res = await getDeckReadUrl({ data: { deckId: deck.id } });
        if (cancelled) return;
        if (!res.url) {
          setState({ phase: "unavailable" });
          return;
        }
        // pdfjs-dist references browser-only globals (DOMMatrix) at module eval,
        // so it must never enter the SSR graph — load it lazily here, on the
        // client, when the viewer actually mounts (the registry imports this
        // component statically into the shell).
        const { pdfjsLib } = await import("@/lib/pdf-worker");
        const doc = (await pdfjsLib.getDocument(res.url).promise) as unknown as PdfDoc;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        loaded = doc;
        setState({ phase: "ready", doc, pages: doc.numPages });
      } catch {
        if (!cancelled) setState({ phase: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [deck.id]);

  // ── render the current page to the canvas whenever page/zoom/doc changes ────
  useEffect(() => {
    if (state.phase !== "ready") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    void (async () => {
      try {
        const pdfPage = await state.doc.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: zoom * window.devicePixelRatio });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / window.devicePixelRatio)}px`;
        canvas.style.height = `${Math.floor(viewport.height / window.devicePixelRatio)}px`;

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;
        pdfPage.cleanup();
      } catch {
        // A cancelled render (fast paging) throws RenderingCancelledException —
        // benign; the next effect run repaints the right page.
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [state, page, zoom]);

  // ── flip-depth reporting (debounced; carries dwell since last flush) ───────
  const flushFlip = useCallback(
    (toPage: number) => {
      const now = Date.now();
      const dwellMs = now - lastFlipAtRef.current;
      lastFlipAtRef.current = now;
      void recordFlipDepth({ data: { deckId: deck.id, page: toPage, dwellMs } }).catch(() => {});
    },
    [deck.id],
  );

  const scheduleFlip = useCallback(
    (toPage: number) => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushFlip(toPage);
      }, FLIP_FLUSH_MS);
    },
    [flushFlip],
  );

  // Cancel any pending debounce and record the dwell accrued on `pageRef.current`
  // right now — used on close/unmount so the last (or only) page's time isn't
  // lost. `flushFlip` advances `lastFlipAtRef`, so a no-op double-flush is safe.
  const flushPending = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    flushFlip(pageRef.current);
  }, [flushFlip]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), Math.max(pages, 1));
      setPage((prev) => {
        if (clamped !== prev) scheduleFlip(clamped);
        return clamped;
      });
    },
    [pages, scheduleFlip],
  );

  // Close handler: flush the dwell accrued on the current page BEFORE tearing
  // down, so the last (or only) page's time lands in deck_progress. Used by the
  // header X and the Escape key.
  const handleClose = useCallback(() => {
    flushPending();
    onClose();
  }, [flushPending, onClose]);

  // Flush the pending dwell on unmount (e.g. the section layer is dismissed
  // without the explicit close button) so the final page's time isn't lost.
  // `flushPending` clears the debounce timer and records the dwell on
  // `pageRef.current`. Reads from refs so the `[]`-dep cleanup sees the latest.
  // A double-flush (handleClose then unmount) is a safe no-op: flushFlip
  // advances lastFlipAtRef, so the second call records ~0ms.
  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;
  useEffect(() => {
    return () => {
      flushPendingRef.current();
    };
  }, []);

  // ── keyboard: arrows page, +/- zoom, Esc closes ────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goTo(page + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goTo(page - 1);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
      } else if (e.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, goTo, handleClose]);

  // Double-tap / double-click toggles a 2× zoom around the fitted scale.
  const onDoubleClick = useCallback(() => {
    setZoom((z) => (z > 1 ? 1 : 2));
  }, []);

  // ── mobile swipe paging (left→prev, right→next) ────────────────────────────
  // Records the start X on touch-down and pages on lift if the horizontal
  // travel clears the threshold. Skipped while zoomed-in (the gesture is a pan
  // of the enlarged canvas, not a page turn) and for multi-touch (pinch-zoom).
  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    // Only single-finger drags page; a second finger means pinch-zoom.
    touchStartXRef.current = e.touches.length === 1 ? (e.touches[0]?.clientX ?? null) : null;
  }, []);

  const onTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      const startX = touchStartXRef.current;
      touchStartXRef.current = null;
      if (startX === null || zoom > 1) return; // no start / zoomed → don't page
      const endX = e.changedTouches[0]?.clientX;
      if (endX === undefined) return;
      const dx = endX - startX;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return; // a tap or a tiny drag
      goTo(dx < 0 ? page + 1 : page - 1); // swipe left → next, right → prev
    },
    [goTo, page, zoom],
  );

  const filmstrip = useMemo(
    () => (pages > 0 ? Array.from({ length: pages }, (_, i) => i + 1) : []),
    [pages],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={deck.title}
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold">{deck.title}</h2>
          {deck.productLine && (
            <p className="truncate text-xs text-muted-foreground">{deck.productLine}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM))}
            >
              <Minus className="size-4" aria-hidden />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM))}
            >
              <Plus className="size-4" aria-hidden />
            </Button>
          </div>
          {deck.downloadAllowed && (
            <Button type="button" variant="outline" size="sm" onClick={onDownload}>
              <Download className="size-4" aria-hidden />
              Download
            </Button>
          )}
          <button
            type="button"
            aria-label="Close deck"
            onClick={handleClose}
            className="flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {state.phase === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}

        {state.phase === "unavailable" && (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <AlertTriangle className="size-10 text-muted-foreground" aria-hidden />
              <div className="max-w-sm space-y-1">
                <p className="font-medium">Preview needs R2</p>
                <p className="text-sm text-muted-foreground">
                  The deck store isn't reachable in this environment, so the PDF can't be rendered
                  here.
                  {deck.downloadAllowed ? " Download the deck to view it locally." : ""}
                </p>
              </div>
              {deck.downloadAllowed && (
                <Button variant="default" onClick={onDownload}>
                  <Download className="size-4" aria-hidden />
                  Download
                </Button>
              )}
            </div>
          </div>
        )}

        {state.phase === "ready" && (
          <div
            className="flex min-h-full touch-pan-y items-center justify-center p-4 sm:p-6"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <canvas
              ref={canvasRef}
              onDoubleClick={onDoubleClick}
              className="max-w-full rounded-sm border border-border bg-white shadow-soft-sm"
              aria-label={`${deck.title} — page ${page} of ${pages}`}
            />
          </div>
        )}

        {/* Edge tap targets — prev/next pager overlay (visible while ready). */}
        {state.phase === "ready" && pages > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => goTo(page - 1)}
              className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/80 text-foreground shadow-soft-sm backdrop-blur transition hover:bg-card disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => goTo(page + 1)}
              className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/80 text-foreground shadow-soft-sm backdrop-blur transition hover:bg-card disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        )}
      </div>

      {state.phase === "ready" && pages > 0 && (
        <footer className="shrink-0 border-t border-border bg-card">
          <div className="flex items-center justify-center gap-3 px-4 py-2 text-sm text-muted-foreground sm:px-6">
            <span className="tabular-nums">
              Page {page} / {pages}
            </span>
          </div>
          {pages > 1 && (
            <div
              role="tablist"
              aria-label="Deck pages"
              className="flex gap-2 overflow-x-auto px-4 pb-3 sm:px-6"
            >
              {filmstrip.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={n === page}
                  aria-label={`Go to page ${n}`}
                  onClick={() => goTo(n)}
                  className={cn(
                    "flex h-12 w-9 shrink-0 items-center justify-center rounded-sm border text-xs tabular-nums transition",
                    n === page
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
