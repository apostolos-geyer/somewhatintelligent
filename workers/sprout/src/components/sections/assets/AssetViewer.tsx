import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Minus, Plus, X } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@greenroom/ui/components/dialog";
import { VideoPlayer } from "@greenroom/ui/components/video-player";
import { getAssetReadUrl, type AssetView } from "@/lib/assets.functions";

interface AssetViewerProps {
  asset: AssetView;
  onClose: () => void;
  /** Triggers the records-download-then-open flow from the owning section. */
  onDownload: () => void;
}

// Zoom bounds + step for the PDF viewer — matched to the PK Decks viewer so the
// two full-screen substrates behave identically (§04 "same substrate as PK Decks").
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/**
 * The in-platform viewer for a single asset, keyed by type:
 *
 *  - pdf   → full-screen `<object>` of the inline roadie URL (browser PDF viewer)
 *  - image → a lightbox `<Dialog>` showing the inline image
 *  - video → the shared `<VideoPlayer>` over the inline URL
 *  - zip   → no viewer; a direct-download prompt (binary archives can't preview)
 *
 * The signed URL is fetched via `getAssetReadUrl`. roadie blob I/O is inert in
 * local dev (no R2), so a null URL degrades to a "preview needs R2" note with a
 * Download fallback — never a broken frame. Loading shows a spinner.
 */
export function AssetViewer({ asset, onClose, onDownload }: AssetViewerProps) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; url: string } | { phase: "unavailable" }
  >({ phase: "loading" });
  // PDF zoom (1 = fit). The control + keyboard live on the full-screen substrate.
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    setZoom(1);
    void (async () => {
      try {
        const res = await getAssetReadUrl({ data: { assetId: asset.id } });
        if (cancelled) return;
        setState(res.url ? { phase: "ready", url: res.url } : { phase: "unavailable" });
      } catch {
        if (!cancelled) setState({ phase: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  // ── keyboard: +/- zoom the PDF, Escape closes (pdf / video substrate only) ──
  useEffect(() => {
    if (asset.type !== "pdf" && asset.type !== "video") return;
    function onKey(e: KeyboardEvent) {
      if (asset.type === "pdf" && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
      } else if (asset.type === "pdf" && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asset.type, onClose]);

  // ── zip: no preview — render a download-only lightbox card ─────────────────
  if (asset.type === "zip") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogTitle className="sr-only">{asset.name}</DialogTitle>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Download className="size-10 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">{asset.name}</p>
              <p className="text-sm text-muted-foreground">
                Archives download to your device — there is no in-platform preview.
              </p>
            </div>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
              <Button variant="default" onClick={onDownload}>
                <Download className="size-4" aria-hidden />
                Download
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── image: lightbox Dialog ─────────────────────────────────────────────────
  if (asset.type === "image") {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton className="sm:max-w-3xl">
          <DialogTitle>{asset.name}</DialogTitle>
          {state.phase === "loading" && (
            <div className="flex min-h-48 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
            </div>
          )}
          {state.phase === "ready" && (
            <img
              src={state.url}
              alt={asset.name}
              className="mx-auto max-h-[70vh] w-auto rounded-sm object-contain"
            />
          )}
          {state.phase === "unavailable" && <PreviewUnavailable onDownload={onDownload} />}
        </DialogContent>
      </Dialog>
    );
  }

  // ── pdf / video: full-screen overlay (sits above the SectionLayer) ─────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={asset.name}
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="min-w-0 truncate font-display text-lg font-bold">{asset.name}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {asset.type === "pdf" && state.phase === "ready" && (
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
          )}
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download className="size-4" aria-hidden />
            Download
          </Button>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {state.phase === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
        {state.phase === "unavailable" && (
          <div className="flex h-full items-center justify-center">
            <PreviewUnavailable onDownload={onDownload} />
          </div>
        )}
        {state.phase === "ready" &&
          asset.type === "pdf" && (
            // The native PDF object is scaled via CSS transform; the wrapper grows
            // with the zoom so the outer container scrolls the enlarged page.
            <div
              className="mx-auto origin-top transition-[width,transform] duration-150"
              style={{ width: `${100 / zoom}%`, transform: `scale(${zoom})` }}
            >
              <object
                data={state.url}
                type="application/pdf"
                className="h-[80vh] w-full rounded-sm border border-border"
                aria-label={asset.name}
              >
                <PreviewUnavailable onDownload={onDownload} />
              </object>
            </div>
          )}
        {state.phase === "ready" && asset.type === "video" && (
          <div className="mx-auto max-w-4xl">
            <VideoPlayer src={state.url} fileName={asset.name} onDownload={onDownload} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The graceful-degradation note shown when the signed URL didn't resolve. */
function PreviewUnavailable({ onDownload }: { onDownload: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <AlertTriangle className="size-10 text-muted-foreground" aria-hidden />
      <div className="max-w-sm space-y-1">
        <p className="font-medium">Preview needs R2</p>
        <p className="text-sm text-muted-foreground">
          The asset store isn't reachable in this environment. Download the file to view it locally.
        </p>
      </div>
      <Button variant="default" onClick={onDownload}>
        <Download className="size-4" aria-hidden />
        Download
      </Button>
    </div>
  );
}
