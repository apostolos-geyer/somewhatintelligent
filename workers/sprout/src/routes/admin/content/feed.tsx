import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { type } from "arktype";
import { ImageIcon, Loader2, MessageCircle, Sprout, Trash2, Upload, Video, X } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button, buttonVariants } from "@greenroom/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
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
import { Badge } from "@greenroom/ui/components/badge";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  createPost,
  deletePost,
  listFeed,
  registerPostMedia,
  type PostCard,
} from "@/lib/feed.functions";
import { listAdminProducts, type AdminProductView } from "@/lib/drops.functions";
import { getAdminPortalConfig } from "@/lib/brand.functions";
import { sha256Hex } from "@/lib/files";

/**
 * Brand-Admin feed composer (P3.B — "Enter the Grow"). Nests under the pathless
 * `admin.tsx` guard the Admin stream owns — SELF-CONTAINED (imports no Admin setup
 * chrome). `createPost` is brand-role gated server-side (`decideBrandAdmin`);
 * brand_id + brand_team are the envelope's activeOrgId / org role, never sent.
 *
 * Media upload is the roadie per-blob 2-step: for each chosen image/video the
 * browser SHA-256s the file, calls `registerPostMedia` (presigned PUT envelope),
 * PUTs the bytes straight to R2, and collects the returned `referenceId`. Once
 * every blob is registered + PUT, `createPost` finalizes each and stamps them into
 * `post_media`. roadie is inert in local dev (no R2): registration returns no
 * envelope, the PUTs are skipped, and the post lands caption-only — surfaced
 * inline so the admin isn't left guessing. The caption/product paths work fully
 * locally.
 */
export const Route = createFileRoute("/admin/content/feed")({
  loader: async () => {
    const [posts, products, portalCfg] = await Promise.all([
      listFeed(),
      listAdminProducts(),
      getAdminPortalConfig(),
    ]);
    return {
      posts,
      products: products.filter((p) => p.archivedAt === null),
      feedLabel: portalCfg.feedLabel,
    };
  },
  component: AdminFeedPage,
});

const MAX_CAPTION = 2200;

/** Map a File's MIME to the feed media kind, or null if unsupported. */
function inferKind(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}

function AdminFeedPage() {
  const { posts, products, feedLabel } = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">{feedLabel}</h1>
        <p className="text-sm text-muted-foreground">
          Post photos, clips, and updates to the brand's media feed. Budtenders like, comment, and
          react in real time.
        </p>
      </header>

      <ComposerCard products={products} onPosted={() => void router.invalidate()} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent posts
        </h2>
        {posts.length === 0 && (
          <p className="text-sm text-muted-foreground">No posts yet. Publish one above.</p>
        )}
        <ul className="space-y-2">
          {posts.map((post) => (
            <li
              key={post.id}
              className={cn("flex items-center gap-3 p-3", surfaceMaterials.brutal)}
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                {post.media[0]?.kind === "video" ? (
                  <Video className="size-5" aria-hidden />
                ) : post.media.length > 0 ? (
                  <ImageIcon className="size-5" aria-hidden />
                ) : (
                  <MessageCircle className="size-5" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={post.caption}>
                  {post.caption || <span className="text-muted-foreground">(no caption)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {post.media.length} media · {post.likeCount} likes · {post.commentCount} comments
                </p>
              </div>
              {post.brandTeam && <Badge variant="sprout-glass">Team</Badge>}
              {post.productId && <Badge variant="outline">Product</Badge>}
              <DeletePostButton post={post} onDeleted={() => void router.invalidate()} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── delete a post (admin; soft-delete, confirm-guarded) ─────────────────────

/**
 * Per-post delete control on the admin feed list. Mirrors the reviews-moderation
 * delete affordance: a confirm dialog guards the (soft) delete because it removes
 * the post from every budtender's feed. `deletePost` is Brand-Admin gated + audited
 * server-side; brand_id is the envelope's activeOrgId, never sent.
 */
function DeletePostButton({ post, onDeleted }: { post: PostCard; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    try {
      await deletePost({ data: { postId: post.id } });
      onDeleted();
    } catch {
      setBusy(false);
    }
  }

  const label = post.caption.trim() || "this post";

  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={busy}
        aria-label="Delete post"
        className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this post?</AlertDialogTitle>
          <AlertDialogDescription>
            “{label}” will be removed from the feed for everyone, along with its likes and comments.
            This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={() => void onDelete()}
          >
            Delete post
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── composer (caption + media roadie upload + optional product) ────────────

const composerSchema = type({
  caption: `string <= ${MAX_CAPTION}`,
  productId: "string",
});

interface PickedMedia {
  file: File;
  kind: "image" | "video";
}

function ComposerCard({
  products,
  onPosted,
}: {
  products: AdminProductView[];
  onPosted: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const productOptions = [
    { value: "", label: "No product" },
    ...products.map((p) => ({ value: p.id, label: p.name })),
  ];

  const form = useAppForm({
    defaultValues: { caption: "", productId: "" },
    validators: { onBlur: composerSchema },
    onSubmit: async ({ value, formApi }) => {
      setComposerError(null);
      setNotice(null);
      const caption = value.caption.trim();
      if (!caption && media.length === 0) {
        setComposerError("Add a caption or at least one image/video.");
        return;
      }
      setBusy(true);
      try {
        // Register + PUT each blob; collect the finalize handles for createPost.
        const registered: Array<{ referenceId: string; kind: "image" | "video" }> = [];
        let skipped = 0;
        for (const item of media) {
          const hash = await sha256Hex(item.file);
          const reg = await registerPostMedia({
            data: {
              kind: item.kind,
              hash,
              size: item.file.size,
              contentType: item.file.type || (item.kind === "video" ? "video/mp4" : "image/png"),
            },
          });
          if (!reg.upload) {
            // roadie inert — can't push bytes; this blob is dropped from the post.
            skipped++;
            continue;
          }
          const put = await fetch(reg.upload.url, {
            method: "PUT",
            headers: reg.upload.headers,
            body: item.file,
          });
          if (!put.ok) {
            skipped++;
            continue;
          }
          registered.push({ referenceId: reg.referenceId, kind: item.kind });
        }

        const res = await createPost({
          data: {
            ...(caption ? { caption } : {}),
            ...(value.productId ? { productId: value.productId } : {}),
            media: registered,
          },
        });

        formApi.reset();
        setMedia([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (skipped > 0) {
          setNotice(
            `Posted with ${res.mediaCount} of ${media.length} media. ${skipped} couldn't upload — the asset store (R2) isn't reachable here.`,
          );
        }
        onPosted();
      } catch (e) {
        setComposerError(e instanceof Error ? e.message : "Couldn't publish the post.");
      } finally {
        setBusy(false);
      }
    },
  });

  function onPickFiles(files: FileList | null) {
    setComposerError(null);
    if (!files) return;
    const next: PickedMedia[] = [];
    for (const file of Array.from(files)) {
      const kind = inferKind(file);
      if (kind) next.push({ file, kind });
    }
    if (next.length === 0) {
      setComposerError("Only images and videos can be posted.");
      return;
    }
    setMedia((cur) => [...cur, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Card className={cn("p-4 md:p-5", surfaceMaterials.brutal)}>
      <CardHeader className="p-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sprout className="size-4 text-primary" aria-hidden />
          New post
        </CardTitle>
        <CardDescription>
          Your posts carry a Team marker automatically. Add a product to link the drop-sheet.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-4">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="caption">
            {(field) => {
              const remaining = MAX_CAPTION - field.state.value.length;
              return (
                <field.TextareaField
                  label="Caption"
                  placeholder="What's growing?"
                  rows={3}
                  description={`${remaining} character${remaining === 1 ? "" : "s"} left`}
                  inputClassName={cn(remaining < 0 && "border-destructive")}
                />
              );
            }}
          </form.AppField>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Media</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => onPickFiles(e.target.files)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-sm file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
            {media.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1">
                {media.map((item, idx) => (
                  <li
                    key={`${item.file.name}-${idx}`}
                    className="flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1 text-xs"
                  >
                    {item.kind === "video" ? (
                      <Video className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                      {item.file.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => setMedia((cur) => cur.filter((_, i) => i !== idx))}
                      className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form.AppField name="productId">
            {(field) => (
              <field.SelectField
                label="Linked product"
                options={productOptions}
                description="Optional — adds a “View product” jump to the post."
              />
            )}
          </form.AppField>

          {composerError && <p className="text-sm text-destructive">{composerError}</p>}
          {notice && <p className="text-sm text-warning-ink">{notice}</p>}

          <Button type="submit" variant="default" disabled={busy} className="w-fit">
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {busy ? "Publishing…" : "Publish post"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
