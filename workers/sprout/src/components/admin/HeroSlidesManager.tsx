import { useEffect, useState } from "react";
import { type } from "arktype";
import { ImageIcon, Pencil, Trash2 } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@greenroom/ui/components/dialog";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { Spinner } from "@greenroom/ui/components/spinner";
import { cn } from "@greenroom/ui/lib/utils";
import {
  deleteHeroSlide,
  finalizeHeroSlide,
  listAdminHeroSlides,
  registerHeroUpload,
  reorderHeroSlides,
  upsertHeroSlide,
  type AdminHeroSlideView,
} from "@/lib/brand.functions";
import { SortableList } from "@/components/admin/SortableList";
import { ErrorBanner } from "@/components/admin/AdminScaffold";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import {
  UploadFileInput,
  UploadSubmitButton,
  uploadViaPresignedPut,
  useUploadState,
} from "@/components/admin/upload";

/**
 * Brand-Admin hero-slide manager — the upload + caption + reorder surface for the
 * landing hero, embedded in Portal setup. Mirrors the asset-library upload flow
 * (`uploadViaPresignedPut`): register (draft row + presigned PUT), PUT the bytes
 * straight to R2, then `finalizeHeroSlide` (enable). roadie is inert in local dev
 * (no R2): the draft row still lands but the PUT/finalize fail — surfaced inline
 * so the admin isn't left guessing. The caption edit, enable toggle, reorder, and
 * delete all work fully locally.
 *
 * brand_id is NEVER sent — every mutation derives it server-side from the verified
 * envelope. Reorder writes `hero_slides.order_idx` to a contiguous 0..n-1 sequence
 * via the keyboard-first `SortableList` (move-up/down buttons are the a11y
 * baseline; the parent owns the optimistic list state and persists on each move).
 */

export function HeroSlidesManager({ onChanged }: { onChanged?: () => void }) {
  const [slides, setSlides] = useState<AdminHeroSlideView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [editing, setEditing] = useState<AdminHeroSlideView | null>(null);

  async function refresh() {
    try {
      setSlides(await listAdminHeroSlides());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load hero slides.");
      setSlides([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onReorder(next: AdminHeroSlideView[]) {
    // Optimistic: paint the new order immediately, then persist. On failure we
    // re-pull the server truth so the list never lies about what's stored.
    const prev = slides;
    setSlides(next.map((s, i) => ({ ...s, orderIdx: i })));
    setReordering(true);
    setError(null);
    try {
      await reorderHeroSlides({ data: { order: next.map((s) => s.id) } });
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed.");
      setSlides(prev);
    } finally {
      setReordering(false);
    }
  }

  async function onDelete(slide: AdminHeroSlideView) {
    setError(null);
    try {
      await deleteHeroSlide({ data: { slideId: slide.id } });
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle>Hero slides</CardTitle>
        <CardDescription>
          Brand images behind your logo on the landing. Upload, caption, and reorder with the
          arrows.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <HeroUpload
          onUploaded={() => {
            void refresh();
            onChanged?.();
          }}
        />

        <ErrorBanner error={error} role="alert" />

        {slides === null && (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-sm" />
            ))}
          </div>
        )}

        {slides !== null && slides.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hero slides yet. Upload one above — the landing falls back to a brand-coloured panel
            until you add your first.
          </p>
        )}

        {slides !== null && slides.length > 0 && (
          <SortableList
            items={slides}
            getKey={(s) => s.id}
            getLabel={(s) => s.headline?.trim() || s.category?.trim() || "Hero slide"}
            onReorder={(next) => void onReorder(next)}
            renderItem={(slide) => (
              <div className="flex items-center gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden rounded-sm border border-border bg-muted">
                  {slide.imageUrl ? (
                    <img
                      src={slide.imageUrl}
                      alt={slide.headline ?? slide.category ?? "Hero slide"}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="size-5" aria-hidden />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {slide.category && <Badge variant="sprout-glass">{slide.category}</Badge>}
                    {!slide.enabled && <Badge variant="outline">Hidden</Badge>}
                    {slide.imageRef.startsWith("pending:") && (
                      <Badge variant="warn">Needs R2</Badge>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 truncate font-medium",
                      !slide.enabled && "text-muted-foreground",
                    )}
                    title={slide.headline ?? undefined}
                  >
                    {slide.headline?.trim() || "Untitled slide"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Edit ${slide.headline ?? "hero slide"}`}
                    onClick={() => setEditing(slide)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <DeleteSlideButton slide={slide} onDelete={() => void onDelete(slide)} />
                </div>
              </div>
            )}
          />
        )}

        {reordering && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner size="xs" /> Saving order…
          </p>
        )}
      </CardContent>

      {editing && (
        <EditSlideDialog
          slide={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
            onChanged?.();
          }}
        />
      )}
    </Card>
  );
}

// ─── upload (roadie 2-step) ─────────────────────────────────────────────────

const uploadSchema = type({
  category: "string <= 80",
  headline: "string <= 160",
});

function HeroUpload({ onUploaded }: { onUploaded: () => void }) {
  const { fileInputRef, file, setFile, busy, uploadError, setUploadError, reset, submitUpload } =
    useUploadState();

  const form = useAppForm({
    defaultValues: { category: "", headline: "" },
    validators: { onBlur: uploadSchema },
    onSubmit: async ({ value, formApi }) => {
      setUploadError(null);
      if (!file) {
        setUploadError("Choose an image first.");
        return;
      }
      if (!file.type.startsWith("image/")) {
        setUploadError("Hero slides must be an image.");
        return;
      }
      await submitUpload({
        formApi,
        onUploaded,
        upload: () =>
          uploadViaPresignedPut({
            file,
            register: async (hash) => {
              const reg = await registerHeroUpload({
                data: {
                  hash,
                  size: file.size,
                  contentType: file.type || "image/png",
                  category: value.category.trim() || undefined,
                  headline: value.headline.trim() || undefined,
                },
              });
              return {
                put: reg.upload,
                finalize: () =>
                  finalizeHeroSlide({
                    data: { slideId: reg.slideId, referenceId: reg.referenceId },
                  }),
              };
            },
            noStoreError:
              "Slide created, but the image store (R2) isn't reachable here, so the image couldn't be uploaded. Provision R2 to publish it.",
            savedNoun: "slide",
          }),
        // The slide row landed even without a byte store — clear the form so a
        // retry doesn't double-create it.
        onError: (outcome) => {
          if (outcome.kind === "no-store") reset(formApi);
        },
      });
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-border bg-muted/30 p-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <UploadFileInput
          label="Image"
          accept="image/*"
          inputRef={fileInputRef}
          onSelect={(f) => {
            setFile(f);
            setUploadError(null);
          }}
        />

        <form.AppField name="category">
          {(field) => (
            <field.TextField
              label="Category tag"
              placeholder="New Arrivals"
              description="Shown as a small badge over the slide. Optional."
            />
          )}
        </form.AppField>

        <form.AppField name="headline">
          {(field) => (
            <field.TextField
              label="Headline"
              placeholder="Fresh genetics, every week."
              description="Optional caption layered on the slide."
            />
          )}
        </form.AppField>

        {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

        <UploadSubmitButton
          busy={busy}
          disabled={busy || !file}
          label="Add slide"
          variant="strong"
        />
      </form>
    </div>
  );
}

// ─── caption + visibility edit ──────────────────────────────────────────────

const editSchema = type({
  category: "string <= 80",
  headline: "string <= 160",
  enabled: "boolean",
});

function EditSlideDialog({
  slide,
  onClose,
  onSaved,
}: {
  slide: AdminHeroSlideView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      category: slide.category ?? "",
      headline: slide.headline ?? "",
      enabled: slide.enabled,
    },
    validators: { onBlur: editSchema },
    onSubmit: ({ value }) =>
      save(() =>
        upsertHeroSlide({
          data: {
            slideId: slide.id,
            category: value.category.trim() || undefined,
            headline: value.headline.trim() || undefined,
            enabled: value.enabled,
          },
        }),
      ),
  });

  return (
    <FormDialog
      form={form}
      title="Edit hero slide"
      description="Update the slide’s caption and visibility. To change the image, delete this slide and upload a new one."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto"
      preface={
        slide.imageUrl && (
          <div className="overflow-hidden rounded-sm border border-border">
            <img
              src={slide.imageUrl}
              alt={slide.headline ?? slide.category ?? "Hero slide"}
              className="aspect-video w-full object-cover"
            />
          </div>
        )
      }
    >
      <form.AppField name="category">
        {(field) => <field.TextField label="Category tag" placeholder="New Arrivals" />}
      </form.AppField>

      <form.AppField name="headline">
        {(field) => <field.TextField label="Headline" placeholder="Fresh genetics, every week." />}
      </form.AppField>

      <form.AppField name="enabled">
        {(field) => (
          <field.SwitchField
            label="Visible on the landing"
            description="Hidden slides stay in the manager but don’t show in the public hero."
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}

// ─── delete (with confirm) ──────────────────────────────────────────────────

function DeleteSlideButton({
  slide,
  onDelete,
}: {
  slide: AdminHeroSlideView;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = slide.headline?.trim() || slide.category?.trim() || "hero slide";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${label}`} />
        }
      >
        <Trash2 className="size-4" aria-hidden />
      </DialogTrigger>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Delete hero slide?</DialogTitle>
          <DialogDescription>
            This removes “{label}” from your landing hero. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              onDelete();
              setOpen(false);
            }}
          >
            {busy && <Spinner size="xs" />}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
