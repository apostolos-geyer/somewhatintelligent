import { useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { cn } from "@greenroom/ui/lib/utils";
import { addComment, type CommentView } from "@/lib/feed.functions";

const MAX_COMMENT = 500;

const commentSchema = type({ body: `1 <= string <= ${MAX_COMMENT}` });

/**
 * The comment composer — ONE `useAppForm` holding a 500-char-counted body. The
 * send is the gated `addComment` server fn (NOT the socket); on success the parent
 * appends the returned comment optimistically (the socket fan-out also delivers it
 * to every other client). The caller's name/id come from the auth session.
 */
export function CommentComposer({
  postId,
  onPosted,
}: {
  postId: string;
  callerId: string;
  callerName: string | null;
  onPosted: (comment: CommentView) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { body: "" },
    validators: { onChange: commentSchema },
    onSubmit: async ({ value, formApi }) => {
      const body = value.body.trim();
      if (!body) return;
      setError(null);
      // Clear the composer immediately for a snappy feel.
      formApi.reset();
      try {
        const res = await addComment({ data: { postId, body } });
        onPosted(res.comment);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't post your comment.");
        // Restore the draft so the budtender can retry.
        formApi.setFieldValue("body", body);
      }
    },
  });

  return (
    <form
      className="shrink-0 space-y-2 border-t border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="body">
        {(field) => {
          const remaining = MAX_COMMENT - field.state.value.length;
          return (
            <field.TextareaField
              label="Add a comment"
              placeholder="Share a thought…"
              rows={2}
              description={`${remaining} character${remaining === 1 ? "" : "s"} left`}
              inputClassName={cn(remaining < 0 && "border-destructive")}
            />
          );
        }}
      </form.AppField>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <form.AppForm>
          <form.SubmitButton label="Comment" loadingLabel="Posting…" />
        </form.AppForm>
      </div>
    </form>
  );
}
