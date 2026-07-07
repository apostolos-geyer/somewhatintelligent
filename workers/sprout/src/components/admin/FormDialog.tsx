import { type ComponentType, type PropsWithChildren, type ReactNode, useState } from "react";
import { Button } from "@greenroom/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@greenroom/ui/components/dialog";

/**
 * Save-error plumbing for admin dialogs: `save` clears the error, runs the
 * mutation, and only calls `onSaved` (close + refresh) on success. Callers doing
 * pre-submit validation set the error directly via `setSaveError`.
 */
export function useSaveHandler(onSaved: () => void) {
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(action: () => Promise<unknown>) {
    setSaveError(null);
    try {
      await action();
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    }
  }

  return { saveError, setSaveError, save };
}

/** The slice of a `useAppForm` instance the dialog shell needs. */
interface FormDialogForm {
  handleSubmit: () => Promise<void>;
  AppForm: ComponentType<PropsWithChildren>;
  SubmitButton: ComponentType<{ label?: string }>;
}

export function FormDialog({
  form,
  title,
  description,
  onClose,
  error,
  submitLabel = "Save",
  contentClassName,
  preface,
  children,
}: {
  form: FormDialogForm;
  title: ReactNode;
  description: ReactNode;
  onClose: () => void;
  error: string | null;
  submitLabel?: string;
  contentClassName?: string;
  /** Rendered between the header and the form (e.g. an image preview). */
  preface?: ReactNode;
  children: ReactNode;
}) {
  const { AppForm, SubmitButton } = form;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {preface}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {children}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <AppForm>
              <SubmitButton label={submitLabel} />
            </AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
