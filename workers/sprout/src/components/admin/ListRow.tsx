import { type ReactNode, useState } from "react";
import { Archive, Loader2, Pencil } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";

export function ListRow({
  dimmed,
  icon,
  title,
  meta,
  actions,
}: {
  dimmed?: boolean;
  icon?: ReactNode;
  title: string;
  meta: ReactNode;
  actions: ReactNode;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium" title={title}>
        {title}
      </p>
      <p className="text-xs text-muted-foreground">{meta}</p>
    </div>
  );

  return (
    <li
      className={cn(
        "flex flex-col gap-3 p-3 sm:flex-row sm:items-center",
        surfaceMaterials.brutal,
        dimmed && "opacity-60",
      )}
    >
      {icon ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {icon}
          {text}
        </div>
      ) : (
        text
      )}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </li>
  );
}

export function RowEditButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} aria-label={ariaLabel}>
      <Pencil className="size-4" aria-hidden />
      Edit
    </Button>
  );
}

/** Soft-delete button: on failure it re-enables so the admin can retry. */
export function ArchiveButton({
  name,
  archive,
  onArchived,
}: {
  name: string;
  archive: () => Promise<unknown>;
  onArchived: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function onArchive() {
    setBusy(true);
    try {
      await archive();
      onArchived();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => void onArchive()}
      aria-label={`Archive ${name}`}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Archive className="size-4" aria-hidden />
      )}
      Archive
    </Button>
  );
}
