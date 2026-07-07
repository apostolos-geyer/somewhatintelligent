import { type ReactNode } from "react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Input } from "@greenroom/ui/components/input";

const MAX_BODY = 2000;

export interface ComposerProps {
  /** Persist + fan-out the message (the gated `sendMessage` server fn). */
  onSubmit: (body: string) => void;
  /** Throttled typing ping over the socket while the draft is non-empty. */
  onTyping?: () => void;
  /** Disabled until the socket session is ready (or while a send is in flight). */
  disabled?: boolean;
  placeholder?: string;
}

/**
 * The group-chat composer, trimmed for
 * the group-chat surface — no @-mention picker (sprout group chat has no mention
 * infrastructure). A single bounded Input + Send button. Typing fires `onTyping`
 * as the draft grows (the parent throttles + emits a `typing` frame over the
 * socket); submit hands the trimmed body to `onSubmit` (the `sendMessage` server
 * fn — NEVER over the socket) and clears the draft. The 2000-char cap mirrors the
 * server validator (a UX guardrail; the security boundary is the arktype edge).
 *
 * Uses `useAppForm` for draft state, but the single-line Input + inline Send +
 * Enter-to-send row is wired by hand via `form.AppField`'s render prop (like
 * ReviewComposer's StarRating) so the kit's stacked TextField label/description
 * layout never breaks the inline composer row.
 */
export function Composer(props: ComposerProps): ReactNode {
  const { onSubmit, onTyping, disabled = false, placeholder = "Message the group…" } = props;

  // The 2000-char cap is enforced by the Input's `maxLength` and the `.slice`
  // on submit; no `useAppForm` validator is needed (the server `sendMessage` fn
  // is the security boundary), so the form just owns the draft string.
  const form = useAppForm({
    defaultValues: { body: "" },
    onSubmit: ({ value, formApi }) => {
      const trimmed = value.body.trim();
      if (!trimmed || disabled) return;
      onSubmit(trimmed.slice(0, MAX_BODY));
      formApi.reset();
    },
  });

  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="body">
        {(field) => (
          <Input
            value={field.state.value}
            onChange={(e) => {
              const next = e.target.value;
              field.handleChange(next);
              if (next.length > 0) onTyping?.();
            }}
            maxLength={MAX_BODY}
            placeholder={placeholder}
            autoComplete="off"
            className="min-w-0 flex-1"
            disabled={disabled}
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => state.values.body.trim().length > 0}>
        {(hasDraft) => (
          <Button type="submit" className="shrink-0" disabled={disabled || !hasDraft}>
            Send
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
