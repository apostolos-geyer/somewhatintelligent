import { useState } from "react";
import { type } from "arktype";
import { CheckCircle2 } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { DialogClose } from "@greenroom/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@greenroom/ui/components/field";
import { requestPhysical } from "@/lib/requests.functions";
import type { AssetView } from "@/lib/assets.functions";

/**
 * The request-physical form (P4.A) — the budtender orders a printed copy of a
 * `physical_available` asset. ONE `useAppForm`: quantity, the store (pre-filled
 * from the brand roster, shown read-only — it is the portal this request is for,
 * never a free-text choice), a one-shot shipping snapshot (street / city /
 * province / postal — `province` a `SelectField` of the Canadian provinces &
 * territories), the contact (name + phone), and an optional note. Submits via the
 * gated `requestPhysical` server fn — `brand_id` + the asset's ownership +
 * `physical_max_qty` cap are all enforced server-side; nothing here picks a brand.
 *
 * The `physicalMaxQty` is surfaced as a guardrail in the quantity field's
 * description when the asset carries one; the server clamps to the cap regardless.
 * On success the form collapses to an inline "Requested ✓" confirmation (§04
 * "request submit confirms inline and the form collapses") rather than just
 * closing — the caller then dismisses the Dialog from the confirmation's action.
 */

/** Canadian provinces + territories — the `SelectField` options for the address. */
const CA_PROVINCES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "YT", label: "Yukon" },
];

const requestSchema = type({
  quantity: "string >= 1",
  store: "string >= 1",
  shipStreet: "string >= 1",
  shipCity: "string >= 1",
  // Province is picked from the SelectField (a closed set of Canadian codes), so a
  // non-empty value is already a valid code; the server re-validates regardless.
  shipProvince: "string >= 1",
  shipPostal: "string >= 1",
  contactName: "string >= 1",
  contactPhone: "string >= 1",
  note: "string",
});

export function RequestPhysicalForm({
  asset,
  storeDefault,
  onSubmitted,
}: {
  asset: AssetView;
  /** Pre-fills the (read-only) store field — the brand name this request is for. */
  storeDefault: string;
  onSubmitted: () => void;
}) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Once the request lands the form collapses to an inline "Requested ✓" panel.
  const [submitted, setSubmitted] = useState(false);

  const form = useAppForm({
    defaultValues: {
      quantity: "1",
      store: storeDefault,
      shipStreet: "",
      shipCity: "",
      shipProvince: "",
      shipPostal: "",
      contactName: "",
      contactPhone: "",
      note: "",
    },
    validators: { onBlur: requestSchema },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      const quantity = Number(value.quantity.trim());
      if (!Number.isFinite(quantity) || quantity < 1) {
        setSubmitError("Quantity must be a whole number of 1 or more.");
        return;
      }
      try {
        await requestPhysical({
          data: {
            assetId: asset.id,
            quantity: Math.floor(quantity),
            // The store is fixed to the brand roster value, never the editable input.
            store: storeDefault.trim(),
            shipStreet: value.shipStreet.trim(),
            shipCity: value.shipCity.trim(),
            shipProvince: value.shipProvince.trim(),
            shipPostal: value.shipPostal.trim(),
            contactName: value.contactName.trim(),
            contactPhone: value.contactPhone.trim(),
            ...(value.note.trim() ? { note: value.note.trim() } : {}),
          },
        });
        setSubmitted(true);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Request failed.");
      }
    },
  });

  // ── Inline confirmation — the form collapses to a "Requested ✓" state ──────
  if (submitted) {
    return (
      <div
        className="flex flex-col items-center gap-4 py-8 text-center"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="size-12 text-sprout" aria-hidden />
        <div className="space-y-1">
          <p className="font-display text-lg font-bold">Requested ✓</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your printed copy of “{asset.name}” is on its way to the brand&apos;s fulfilment queue.
            Track its status under My Requests.
          </p>
        </div>
        <Button type="button" variant="default" onClick={onSubmitted}>
          Done
        </Button>
      </div>
    );
  }

  const qtyDescription =
    asset.physicalMaxQty != null && asset.physicalMaxQty > 0
      ? `Up to ${asset.physicalMaxQty} per request.`
      : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="quantity">
          {(field) => (
            <field.TextField
              label="Quantity"
              type="text"
              placeholder="1"
              description={qtyDescription}
            />
          )}
        </form.AppField>
        {/* Store is pre-filled from the brand roster and NOT editable — this request
            is for the active portal's brand; the user can't retarget it. */}
        <Field>
          <FieldLabel htmlFor="request-store">Store</FieldLabel>
          <output
            id="request-store"
            className="flex h-10 w-full min-w-0 items-center rounded-sm border-2 border-border bg-muted/40 px-3 py-2 text-base text-muted-foreground"
          >
            {storeDefault || "Your store"}
          </output>
          <FieldDescription>Set from your roster.</FieldDescription>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Shipping address</legend>

        <form.AppField name="shipStreet">
          {(field) => <field.TextField label="Street address" placeholder="123 Main St, Unit 4" />}
        </form.AppField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <form.AppField name="shipCity">
            {(field) => <field.TextField label="City" placeholder="Toronto" />}
          </form.AppField>
          <form.AppField name="shipProvince">
            {(field) => (
              <field.SelectField
                label="Province"
                placeholder="Select province"
                options={CA_PROVINCES.map((p) => ({ value: p.value, label: p.label }))}
              />
            )}
          </form.AppField>
        </div>

        <form.AppField name="shipPostal">
          {(field) => <field.TextField label="Postal code" placeholder="M5V 2T6" />}
        </form.AppField>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="contactName">
          {(field) => <field.TextField label="Contact name" placeholder="Full name" />}
        </form.AppField>
        <form.AppField name="contactPhone">
          {(field) => (
            <field.TextField label="Contact phone" type="tel" placeholder="(416) 555-0100" />
          )}
        </form.AppField>
      </div>

      <form.AppField name="note">
        {(field) => (
          <field.TextareaField
            label="Note"
            rows={2}
            placeholder="Anything the fulfilment team should know. Optional."
          />
        )}
      </form.AppField>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="flex justify-end gap-2">
        <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
        <form.AppForm>
          <form.SubmitButton label="Submit request" loadingLabel="Submitting…" />
        </form.AppForm>
      </div>
    </form>
  );
}
