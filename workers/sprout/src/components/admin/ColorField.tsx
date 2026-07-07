import type { AnyFieldApi } from "@tanstack/react-form";
import { Input } from "@greenroom/ui/components/input";
import { Field, FieldDescription, FieldLabel } from "@greenroom/ui/components/field";
import { cn } from "@greenroom/ui/lib/utils";

/**
 * A colour input compatible with `useAppForm`. Unlike the registered field
 * components (which read `useFieldContext`), this takes the `field` API directly
 * from a `form.AppField` render prop — colour isn't one of the kit's built-in
 * field kinds, so we wire it by hand while keeping the same `Field`/`FieldLabel`
 * chrome.
 *
 * Two coupled controls drive ONE value: a native `<input type="color">` swatch
 * (for quick picking) and a hex text input (for paste + clear). Both write the
 * same string via `field.handleChange`, so the parent's live-preview effect (it
 * subscribes to the form value and mutates `--color-*` CSS vars before save)
 * updates on every keystroke. An empty value clears the override.
 *
 * `onValueChange` is an optional escape hatch for callers that want the new
 * value imperatively (e.g. to drive a non-form preview); the form value is still
 * the source of truth.
 */
export function ColorField({
  field,
  label,
  description,
  onValueChange,
  className,
}: {
  field: AnyFieldApi;
  label: string;
  description?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  const value = (field.state.value as string | undefined) ?? "";
  // A native colour input requires a 7-char #rrggbb; fall back to a neutral so
  // the swatch always renders even while the text field holds a partial value.
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#888888";

  const set = (next: string) => {
    field.handleChange(next);
    onValueChange?.(next);
  };

  return (
    <Field className={cn(className)}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={swatch}
          onChange={(e) => set(e.target.value)}
          onBlur={field.handleBlur}
          className="size-10 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0.5"
        />
        <Input
          id={field.name}
          name={field.name}
          value={value}
          onChange={(e) => set(e.target.value)}
          onBlur={field.handleBlur}
          placeholder="#000000 or oklch(…)"
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono"
        />
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}
