/**
 * Searchable id picker (RFC-0001 wave-1 UX): a thin wrapper over @si/ui's
 * `SearchCombobox` that trades a typed-id `Input` for a debounced search that
 * submits an id. Callers map their domain rows to `PickerOption`; the picker
 * owns resolving the currently-referenced id back to a label on load (the page
 * document stores only the id) and fabricates a "not found" placeholder when a
 * stored id no longer resolves, so the field is always clearable.
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SearchCombobox } from "@si/ui/components/search-combobox";

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string | null;
  /** Present (possibly null) only for media rows — drives the thumbnail slot. */
  thumbnailHref?: string | null;
}

export function EntityPicker({
  valueId,
  onChange,
  search,
  resolve,
  placeholder,
  emptyText,
  minChars,
  id,
  invalid,
}: {
  valueId: string | null;
  onChange: (id: string | null) => void;
  search: (query: string) => Promise<PickerOption[]>;
  resolve: (id: string) => Promise<PickerOption | null>;
  placeholder?: string;
  emptyText?: string;
  minChars?: number;
  id?: string;
  invalid?: boolean;
}) {
  const [selected, setSelected] = useState<PickerOption | null>(null);
  const resolvedIdRef = useRef<string | null>(null);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  });

  // Resolve the referenced id to a label whenever it changes from the outside;
  // a manual pick sets `resolvedIdRef` up front so this stays a no-op for it.
  useEffect(() => {
    if (valueId === null) {
      resolvedIdRef.current = null;
      setSelected(null);
      return;
    }
    if (resolvedIdRef.current === valueId) return;
    let cancelled = false;
    void resolveRef.current(valueId).then((opt) => {
      if (cancelled) return;
      resolvedIdRef.current = valueId;
      setSelected(opt ?? { id: valueId, label: valueId, sublabel: "not found" });
    });
    return () => {
      cancelled = true;
    };
  }, [valueId]);

  return (
    <SearchCombobox<PickerOption>
      value={selected}
      onSelect={(opt) => {
        resolvedIdRef.current = opt?.id ?? null;
        setSelected(opt);
        onChange(opt?.id ?? null);
      }}
      search={search}
      itemToKey={(o) => o.id}
      itemToLabel={(o) => o.label}
      renderItem={(o, active) => <PickerRow option={o} active={active} />}
      placeholder={placeholder}
      emptyText={emptyText}
      minChars={minChars}
      id={id}
      aria-invalid={invalid}
    />
  );
}

function PickerRow({ option, active }: { option: PickerOption; active: boolean }): ReactNode {
  return (
    <div className={"flex items-center gap-3 px-3 py-2 " + (active ? "bg-muted" : "")}>
      {option.thumbnailHref !== undefined && (
        <span className="bg-muted size-8 shrink-0 overflow-hidden rounded-sm">
          {option.thumbnailHref ? (
            <img src={option.thumbnailHref} alt="" className="size-full object-cover" />
          ) : null}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground truncate text-sm">{option.label}</span>
        {option.sublabel ? (
          <span className="text-muted-foreground truncate font-mono text-[10px]">
            {option.sublabel}
          </span>
        ) : null}
      </span>
    </div>
  );
}
