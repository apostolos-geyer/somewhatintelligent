import { useEffect, useMemo, useState } from "react";
import { Download, Eye, FolderDown, Library, Package, Search } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@greenroom/ui/components/dialog";
import { FileIcon } from "@greenroom/ui/components/file-icon";
import { Input } from "@greenroom/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@greenroom/ui/components/select";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@greenroom/ui/components/tabs";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { usePortalContext } from "@/components/shell/portal-context";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import {
  getAssetReadUrl,
  getAssetThumbUrl,
  listAssets,
  recordDownload,
  type AssetType,
  type AssetView,
} from "@/lib/assets.functions";
import { AssetViewer } from "./AssetViewer";
import { MyRequests } from "./MyRequests";
import { RequestPhysicalForm } from "./RequestPhysicalForm";
import { formatSize } from "@/lib/files";

/** roadie `type` → a representative MIME so the shared FileIcon picks the glyph. */
const MIME_BY_TYPE: Record<AssetType, string> = {
  pdf: "application/pdf",
  image: "image/png",
  video: "video/mp4",
  zip: "application/zip",
};

/** Sentinel for the "all categories" filter option (empty string isn't selectable). */
const ALL_CATEGORIES = "__all__";

/** The category an asset belongs to (null → "Uncategorized"). */
function categoryOf(asset: AssetView): string {
  return asset.category?.trim() || "Uncategorized";
}

/** Group assets by category, preserving server order. */
function groupByCategory(assets: AssetView[]): Array<{ category: string; items: AssetView[] }> {
  const groups = new Map<string, AssetView[]>();
  for (const a of assets) {
    const key = categoryOf(a);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
}

/**
 * The asset card's thumbnail. When `hasThumb`, it lazily fetches a signed inline
 * read URL via `getAssetThumbUrl` (a passive read — no download is recorded) and
 * shows the image; on a null URL (no thumb / roadie inert in local dev) or any
 * failure it degrades to the generic `FileIcon` glyph rather than a broken frame.
 */
function AssetThumb({ asset }: { asset: AssetView }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!asset.hasThumb) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getAssetThumbUrl({ data: { assetId: asset.id } });
        if (!cancelled) setUrl(res.url);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id, asset.hasThumb]);

  if (asset.hasThumb && url) {
    return <img src={url} alt="" className="size-8 shrink-0 rounded-sm object-cover" aria-hidden />;
  }
  return <FileIcon mimeType={MIME_BY_TYPE[asset.type]} className="size-8 shrink-0 text-primary" />;
}

/**
 * The Store-Assets library (Surface 6) — rendered full-screen inside the
 * SectionLayer via the registry, so it takes no props. It reads the active brand
 * from the portal route context and its deep-link target from `useLayerStack().item`:
 * an `?item=<assetId>` deep-links straight into the in-platform viewer.
 *
 * A Tabs header switches between:
 *  - Library — a categorised, SEARCHABLE grid of asset cards. A search `Input` +
 *    a category `Select` head the layer; each card shows a thumbnail (or a type
 *    glyph), name, type, and size, plus DOWNLOAD (records the download then
 *    triggers the signed-URL fetch), OPEN (mounts the AssetViewer), and — when
 *    `physical_available` — REQUEST PHYSICAL.
 *  - My Requests — the caller's own physical-print request status list (the same
 *    view as the deep-linkable `/requests` route), surfaced inline here.
 *
 * Loading → Skeleton; empty → a quiet empty state.
 */
export function AssetsSection() {
  const { brand } = usePortalContext();
  const { item, setItem } = useLayerStack();

  const [assets, setAssets] = useState<AssetView[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // The asset whose "Request physical" Dialog is open, if any.
  const [requesting, setRequesting] = useState<AssetView | null>(null);
  // Library filters.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    void (async () => {
      try {
        const rows = await listAssets();
        if (!cancelled) setAssets(rows);
      } catch {
        if (!cancelled) setAssets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand?.orgId]);

  // The distinct categories present, in server order, for the filter `Select`.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of assets ?? []) {
      const c = categoryOf(a);
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  }, [assets]);

  // The visible set after the search + category filters. Search matches name and
  // category (case-insensitive); the category filter narrows to one bucket.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (assets ?? []).filter((a) => {
      if (category !== ALL_CATEGORIES && categoryOf(a) !== category) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || categoryOf(a).toLowerCase().includes(q);
    });
  }, [assets, query, category]);

  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  // The deep-linked / opened asset, resolved against the loaded list (not the
  // filtered view — a deep link must resolve even when a filter would hide it).
  const openAsset = useMemo(
    () => (item ? (assets?.find((a) => a.id === item) ?? null) : null),
    [item, assets],
  );

  async function onDownload(asset: AssetView) {
    setDownloading(asset.id);
    try {
      await recordDownload({ data: { assetId: asset.id } });
      const res = await getAssetReadUrl({ data: { assetId: asset.id } });
      if (res.url) {
        // attachment-disposition URLs download; inline ones open the blob — both
        // are the intended "get the file" action from the card.
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // roadie inert / failed — the counter still bumped; nothing to open.
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <div className="mx-auto max-w-5xl">
        <Tabs defaultValue="library">
          <TabsList className="mb-6">
            <TabsTrigger value="library">
              <Library className="size-4" aria-hidden />
              Library
            </TabsTrigger>
            <TabsTrigger value="requests">
              <Package className="size-4" aria-hidden />
              My Requests
            </TabsTrigger>
          </TabsList>

          <TabsContent value="library">
            {/* ── Loading ──────────────────────────────────────────────────── */}
            {assets === null && (
              <div className="space-y-6">
                {[0, 1].map((g) => (
                  <div key={g} className="space-y-3">
                    <Skeleton className="h-5 w-40" />
                    <div className="grid grid-cols-1 gap-grid sm:grid-cols-2 lg:grid-cols-3">
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-md" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Empty (no assets at all) ─────────────────────────────────── */}
            {assets !== null && assets.length === 0 && (
              <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
                <FolderDown className="size-10 text-muted-foreground" aria-hidden />
                <h3 className="font-display text-lg font-bold">No assets yet</h3>
                <p className="text-sm text-muted-foreground">
                  When {brand?.name ?? "the brand"} publishes brochures, shelf-talkers, or
                  downloadable kit, it will appear here.
                </p>
              </div>
            )}

            {/* ── Library (search + filter + grid) ─────────────────────────── */}
            {assets !== null && assets.length > 0 && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search assets"
                      aria-label="Search assets"
                      className="pl-9"
                    />
                  </div>
                  <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                    <SelectTrigger className="w-full sm:w-56" aria-label="Filter by category">
                      {/* Map the sentinel value to its label so the trigger never
                          shows the raw "__all__" key. */}
                      <SelectValue placeholder="All categories">
                        {(value: string) => (value === ALL_CATEGORIES ? "All categories" : value)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="sr-only" role="status" aria-live="polite">
                  {filtered.length} {filtered.length === 1 ? "asset" : "assets"} found
                </p>

                {groups.length === 0 ? (
                  <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
                    <Search className="size-9 text-muted-foreground" aria-hidden />
                    <h3 className="font-display text-base font-bold">No matching assets</h3>
                    <p className="text-sm text-muted-foreground">
                      Nothing matches your search in this category. Try a different term.
                    </p>
                  </div>
                ) : (
                  groups.map((group) => (
                    <section key={group.category} className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.category}
                      </h3>
                      <div
                        role="list"
                        className="grid grid-cols-1 gap-grid sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {group.items.map((asset) => (
                          <Card
                            key={asset.id}
                            role="listitem"
                            className={cn("flex flex-col gap-3 p-4", surfaceMaterials.brutal)}
                          >
                            <div className="flex items-start gap-3">
                              <AssetThumb asset={asset} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium" title={asset.name}>
                                  {asset.name}
                                </p>
                                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                  {asset.type} · {formatSize(asset.sizeBytes)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-auto flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => setItem(asset.id)}
                                  aria-label={`Open ${asset.name}`}
                                >
                                  <Eye className="size-4" aria-hidden />
                                  Open
                                </Button>
                                <Button
                                  type="button"
                                  variant="default"
                                  size="sm"
                                  className="flex-1"
                                  disabled={downloading === asset.id}
                                  onClick={() => void onDownload(asset)}
                                  aria-label={`Download ${asset.name}`}
                                >
                                  <Download className="size-4" aria-hidden />
                                  {downloading === asset.id ? "…" : "Download"}
                                </Button>
                              </div>
                              {asset.physicalAvailable && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="w-full"
                                  onClick={() => setRequesting(asset)}
                                  aria-label={`Request a printed copy of ${asset.name}`}
                                >
                                  <Package className="size-4" aria-hidden />
                                  Request physical
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests">
            <MyRequests />
          </TabsContent>
        </Tabs>
      </div>

      {openAsset && (
        <AssetViewer
          asset={openAsset}
          onClose={() => setItem(undefined)}
          onDownload={() => void onDownload(openAsset)}
        />
      )}

      {requesting && (
        <Dialog open onOpenChange={(open) => !open && setRequesting(null)}>
          <DialogContent showCloseButton className="max-h-[90vh] overflow-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Request a printed copy</DialogTitle>
              <DialogDescription>
                Order a physical print of “{requesting.name}” shipped to your store. The brand
                reviews and fulfils your request — track its status under My Requests.
              </DialogDescription>
            </DialogHeader>
            <RequestPhysicalForm
              asset={requesting}
              storeDefault={brand?.name ?? ""}
              onSubmitted={() => setRequesting(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
