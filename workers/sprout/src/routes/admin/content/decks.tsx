import { createFileRoute, useRouter } from "@tanstack/react-router";
import { type } from "arktype";
import { FileText } from "lucide-react";
import { useState } from "react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Badge } from "@greenroom/ui/components/badge";
import { FileIcon } from "@greenroom/ui/components/file-icon";
import {
  archiveDeck,
  finalizeDeckUpload,
  listAdminDecks,
  registerDeckUpload,
  upsertDeckMeta,
  type AdminDeckView,
} from "@/lib/decks.functions";
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
 * Brand-Admin PK-deck library management (P2.C). Nests under the pathless
 * `admin.tsx` guard the Admin stream owns — this route is SELF-CONTAINED (it
 * imports no Admin setup chrome). The mutations are brand-role gated server-side
 * (`decideBrandAdmin`); brand_id is the envelope's activeOrgId, never sent.
 *
 * Upload is the roadie 2-step (`uploadViaPresignedPut`): register (draft row +
 * presigned PUT), PUT the bytes straight to R2, then `finalizeDeckUpload`
 * (publish + enqueue `deck.derive`). roadie is inert in local dev (no R2): the
 * draft row still lands, but the PUT/finalize fail — surfaced inline. The
 * list/metadata/archive paths work fully locally; a just-finalized deck shows
 * "Processing" until the derive job stamps page_count.
 */
export const Route = createFileRoute("/admin/content/decks")({
  loader: () => listAdminDecks(),
  component: AdminDecksPage,
});

function AdminDecksPage() {
  const decks = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminDeckView | null>(null);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="PK decks"
        description="Product-knowledge decks (PDF) budtenders flip through in the portal. Page count and the cover thumbnail are derived after upload."
      />

      <UploadCard onUploaded={() => void router.invalidate()} />

      <AdminSection title="Library">
        {decks.length === 0 && (
          <p className="text-sm text-muted-foreground">No decks yet. Upload one above.</p>
        )}
        <ul className="space-y-2">
          {decks.map((deck) => (
            <ListRow
              key={deck.id}
              dimmed={deck.archivedAt != null}
              icon={
                <FileIcon mimeType="application/pdf" className="size-7 shrink-0 text-primary" />
              }
              title={deck.title}
              meta={
                <>
                  {deck.productLine ?? "No product line"} ·{" "}
                  {deck.pageCount > 0 ? `${deck.pageCount} pages` : "Processing…"}
                </>
              }
              actions={
                <>
                  {deck.status === "draft" && <Badge variant="warn">Draft</Badge>}
                  {deck.status === "published" && deck.pageCount === 0 && (
                    <Badge variant="outline">Processing</Badge>
                  )}
                  {deck.archivedAt && <Badge variant="outline">Archived</Badge>}
                  {deck.downloadAllowed && <Badge variant="info">Downloadable</Badge>}
                  <RowEditButton
                    ariaLabel={`Edit ${deck.title}`}
                    onClick={() => setEditing(deck)}
                  />
                  {!deck.archivedAt && (
                    <ArchiveButton
                      name={deck.title}
                      archive={() => archiveDeck({ data: { deckId: deck.id } })}
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
          deck={editing}
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
  title: "string >= 1",
  productLine: "string",
  downloadAllowed: "boolean",
});

function UploadCard({ onUploaded }: { onUploaded: () => void }) {
  const { fileInputRef, file, setFile, busy, uploadError, setUploadError, submitUpload } =
    useUploadState();

  const form = useAppForm({
    defaultValues: { title: "", productLine: "", downloadAllowed: false },
    validators: { onBlur: uploadSchema },
    onSubmit: async ({ value, formApi }) => {
      setUploadError(null);
      if (!file) {
        setUploadError("Choose a PDF first.");
        return;
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setUploadError("Decks must be a PDF.");
        return;
      }
      await submitUpload({
        formApi,
        onUploaded,
        upload: () =>
          uploadViaPresignedPut({
            file,
            register: async (hash) => {
              const reg = await registerDeckUpload({
                data: {
                  title: value.title.trim(),
                  productLine: value.productLine.trim() || undefined,
                  downloadAllowed: value.downloadAllowed,
                  hash,
                  size: file.size,
                  contentType: file.type || "application/pdf",
                },
              });
              return {
                put: reg.uploadUrl,
                finalize: () =>
                  finalizeDeckUpload({
                    data: { deckId: reg.deckId, referenceId: reg.referenceId },
                  }),
              };
            },
            noStoreError:
              "Draft created, but the deck store (R2) isn't reachable here, so the PDF couldn't be uploaded. Provision R2 to finish publishing.",
            savedNoun: "draft",
          }),
      });
    },
  });

  return (
    <UploadCardShell
      title="Upload a deck"
      description="The PDF is hashed and stored once; page count and a cover thumbnail are derived after upload."
      onSubmit={() => void form.handleSubmit()}
      error={uploadError}
      busy={busy}
      canSubmit={!!file}
    >
      <UploadFileInput
        label="PDF"
        accept="application/pdf,.pdf"
        inputRef={fileInputRef}
        onSelect={(f) => {
          setFile(f);
          setUploadError(null);
          // Pre-fill the title from the filename if blank.
          if (f && !form.getFieldValue("title")) {
            form.setFieldValue("title", f.name.replace(/\.[^.]+$/, ""));
          }
        }}
        hint={
          file && (
            <p className="text-xs text-muted-foreground">
              <FileText className="mr-1 inline size-3" aria-hidden />
              PDF · {formatSize(file.size)}
            </p>
          )
        }
      />

      <form.AppField name="title">
        {(field) => <field.TextField label="Title" placeholder="Spring 2026 PK deck" />}
      </form.AppField>

      <form.AppField name="productLine">
        {(field) => (
          <field.TextField
            label="Product line"
            placeholder="Flower"
            description="Groups the deck by product family in the library. Optional."
          />
        )}
      </form.AppField>

      <form.AppField name="downloadAllowed">
        {(field) => (
          <field.SwitchField
            label="Allow download"
            description="Lets budtenders download the PDF from the flip-viewer."
          />
        )}
      </form.AppField>
    </UploadCardShell>
  );
}

// ─── metadata edit (title, product line, download flag) ─────────────────────

const metaSchema = type({
  title: "string >= 1",
  productLine: "string",
  downloadAllowed: "boolean",
});

function EditMetaDialog({
  deck,
  onClose,
  onSaved,
}: {
  deck: AdminDeckView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      title: deck.title,
      productLine: deck.productLine ?? "",
      downloadAllowed: deck.downloadAllowed,
    },
    validators: { onBlur: metaSchema },
    onSubmit: ({ value }) =>
      save(() =>
        upsertDeckMeta({
          data: {
            deckId: deck.id,
            title: value.title.trim(),
            productLine: value.productLine.trim() || undefined,
            downloadAllowed: value.downloadAllowed,
          },
        }),
      ),
  });

  return (
    <FormDialog
      form={form}
      title="Edit deck"
      description="Re-uploading a deck's PDF isn't supported here — archive this one and upload a new deck."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto"
    >
      <form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>

      <form.AppField name="productLine">
        {(field) => <field.TextField label="Product line" placeholder="Flower" />}
      </form.AppField>

      <form.AppField name="downloadAllowed">
        {(field) => (
          <field.SwitchField
            label="Allow download"
            description="Lets budtenders download the PDF from the flip-viewer."
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}
