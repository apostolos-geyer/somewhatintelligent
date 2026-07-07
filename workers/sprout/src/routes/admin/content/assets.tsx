import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Badge } from "@greenroom/ui/components/badge";
import { FileIcon } from "@greenroom/ui/components/file-icon";
import {
  archiveAsset,
  finalizeAssetUpload,
  isAssetType,
  listAdminAssets,
  registerAssetUpload,
  upsertAssetMeta,
  type AdminAssetView,
  type AssetType,
} from "@/lib/assets.functions";
import { AdminPageHeader, AdminSection } from "@/components/admin/AdminScaffold";
import { ArchiveButton, ListRow, RowEditButton } from "@/components/admin/ListRow";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import { formatSize } from "@/lib/files";
import {
  UploadCardShell,
  UploadFileInput,
  uploadViaPresignedPut,
  useUploadState,
} from "@/components/admin/upload";

/**
 * Brand-Admin asset library management (P1.D). Nests under the pathless
 * `admin.tsx` guard the Admin stream owns — this route is SELF-CONTAINED (it
 * imports no Admin setup chrome). The mutations are brand-role gated server-side
 * (`decideBrandAdmin`); brand_id is the envelope's activeOrgId, never sent.
 *
 * Upload is the roadie 2-step (`uploadViaPresignedPut`): register (draft row +
 * presigned PUT), PUT the bytes straight to R2, then `finalizeAssetUpload`
 * (publish). roadie is inert in local dev (no R2): the draft row still lands, but
 * the PUT/finalize fail — surfaced inline so the admin isn't left guessing. The
 * metadata/list/archive paths work fully locally.
 */
export const Route = createFileRoute("/admin/content/assets")({
  loader: () => listAdminAssets(),
  component: AdminAssetsPage,
});

const TYPE_LABEL: Record<AssetType, string> = {
  pdf: "PDF",
  image: "Image",
  video: "Video",
  zip: "Archive (zip)",
};

const MIME_BY_TYPE: Record<AssetType, string> = {
  pdf: "application/pdf",
  image: "image/png",
  video: "video/mp4",
  zip: "application/zip",
};

/** Map a File's name/MIME to one of the four asset types (best-effort default pdf). */
function inferType(file: File): AssetType {
  const mime = file.type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/zip" || file.name.toLowerCase().endsWith(".zip")) return "zip";
  return "pdf";
}

function AdminAssetsPage() {
  const assets = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminAssetView | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Store assets"
        description="Brochures, shelf-talkers, and downloadable kit budtenders can grab from the portal."
      />

      <UploadCard onUploaded={() => void router.invalidate()} />

      <AdminSection title="Library">
        {assets.length === 0 && (
          <p className="text-sm text-muted-foreground">No assets yet. Upload one above.</p>
        )}
        <ul className="space-y-2">
          {assets.map((asset) => (
            <ListRow
              key={asset.id}
              dimmed={asset.archivedAt != null}
              icon={
                <FileIcon
                  mimeType={MIME_BY_TYPE[asset.type]}
                  className="size-7 shrink-0 text-primary"
                />
              }
              title={asset.name}
              meta={
                <>
                  {asset.category ?? "Uncategorized"} · {TYPE_LABEL[asset.type]} ·{" "}
                  {formatSize(asset.sizeBytes)} · {asset.downloadCount} downloads
                </>
              }
              actions={
                <>
                  {asset.status === "draft" && <Badge variant="warn">Draft</Badge>}
                  {asset.archivedAt && <Badge variant="outline">Archived</Badge>}
                  {asset.physicalAvailable && <Badge variant="info">Physical</Badge>}
                  <RowEditButton
                    ariaLabel={`Edit ${asset.name}`}
                    onClick={() => setEditing(asset)}
                  />
                  {!asset.archivedAt && (
                    <ArchiveButton
                      name={asset.name}
                      archive={() => archiveAsset({ data: { assetId: asset.id } })}
                      onArchived={() => void router.invalidate()}
                    />
                  )}
                </>
              }
            />
          ))}
        </ul>
      </AdminSection>

      {editing && (
        <EditMetaDialog
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void router.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ─── upload (roadie 2-step) ─────────────────────────────────────────────────

const uploadSchema = type({
  name: "string >= 1",
  category: "string",
});

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { fileInputRef, file, setFile, busy, uploadError, setUploadError, submitUpload } =
    useUploadState();

  const form = useAppForm({
    defaultValues: { name: "", category: "" },
    validators: { onBlur: uploadSchema },
    onSubmit: async ({ value, formApi }) => {
      setUploadError(null);
      if (!file) {
        setUploadError("Choose a file first.");
        return;
      }
      const type = inferType(file);
      if (!isAssetType(type)) {
        setUploadError("Unsupported file type.");
        return;
      }
      await submitUpload({
        formApi,
        onUploaded,
        upload: () =>
          uploadViaPresignedPut({
            file,
            register: async (hash) => {
              const reg = await registerAssetUpload({
                data: {
                  name: value.name.trim(),
                  category: value.category.trim() || undefined,
                  type,
                  hash,
                  size: file.size,
                  contentType: file.type || MIME_BY_TYPE[type],
                },
              });
              return {
                put: reg.upload,
                finalize: () =>
                  finalizeAssetUpload({
                    data: { assetId: reg.assetId, referenceId: reg.referenceId },
                  }),
              };
            },
            noStoreError:
              "Draft created, but the asset store (R2) isn't reachable here, so the file couldn't be uploaded. Provision R2 to finish publishing.",
            savedNoun: "draft",
          }),
      });
    },
  });

  return (
    <UploadCardShell
      title="Upload an asset"
      description="The file is hashed and stored once; budtenders download it from the portal."
      onSubmit={() => void form.handleSubmit()}
      error={uploadError}
      busy={busy}
      canSubmit={!!file}
    >
      <UploadFileInput
        label="File"
        inputRef={fileInputRef}
        onSelect={(f) => {
          setFile(f);
          setUploadError(null);
          // Pre-fill the name from the filename if blank.
          if (f && !form.getFieldValue("name")) {
            form.setFieldValue("name", f.name.replace(/\.[^.]+$/, ""));
          }
        }}
        hint={
          file && (
            <p className="text-xs text-muted-foreground">
              {TYPE_LABEL[inferType(file)]} · {formatSize(file.size)}
            </p>
          )
        }
      />

      <form.AppField name="name">
        {(field) => <field.TextField label="Name" placeholder="Spring shelf-talker" />}
      </form.AppField>

      <form.AppField name="category">
        {(field) => (
          <field.TextField
            label="Category"
            placeholder="Brochures"
            description="Groups the asset in the budtender library. Optional."
          />
        )}
      </form.AppField>
    </UploadCardShell>
  );
}

// ─── metadata edit (name, category, physical flags) ─────────────────────────

const metaSchema = type({
  name: "string >= 1",
  category: "string",
  physicalAvailable: "boolean",
  physicalMaxQty: "string",
});

function EditMetaDialog({
  asset,
  onClose,
  onSaved,
}: {
  asset: AdminAssetView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, setSaveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      name: asset.name,
      category: asset.category ?? "",
      physicalAvailable: asset.physicalAvailable,
      physicalMaxQty: asset.physicalMaxQty != null ? String(asset.physicalMaxQty) : "",
    },
    validators: { onBlur: metaSchema },
    onSubmit: async ({ value }) => {
      const parsedQty = value.physicalMaxQty.trim()
        ? Number(value.physicalMaxQty.trim())
        : undefined;
      if (parsedQty !== undefined && (!Number.isFinite(parsedQty) || parsedQty < 0)) {
        setSaveError("Max quantity must be a non-negative number.");
        return;
      }
      await save(() =>
        upsertAssetMeta({
          data: {
            assetId: asset.id,
            name: value.name.trim(),
            category: value.category.trim() || undefined,
            physicalAvailable: value.physicalAvailable,
            ...(parsedQty !== undefined ? { physicalMaxQty: parsedQty } : {}),
          },
        }),
      );
    },
  });

  return (
    <FormDialog
      form={form}
      title="Edit asset"
      description="Physical-print availability is set here but inert until fulfilment ships."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto"
    >
      <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>

      <form.AppField name="category">
        {(field) => <field.TextField label="Category" placeholder="Brochures" />}
      </form.AppField>

      <form.AppField name="physicalAvailable">
        {(field) => (
          <field.SwitchField
            label="Available as physical print"
            description="Lets budtenders request a printed copy (fulfilment lands later)."
          />
        )}
      </form.AppField>

      <form.Subscribe selector={(s) => s.values.physicalAvailable}>
        {(physicalAvailable) =>
          physicalAvailable ? (
            <form.AppField name="physicalMaxQty">
              {(field) => (
                <field.TextField
                  label="Max quantity per request"
                  type="text"
                  placeholder="Leave blank for no cap"
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>
    </FormDialog>
  );
}
