import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";
import { compactMaterials } from "@si/ui/lib/materials";

const accentVariants = {
  // Solid ink fills
  ink: "bg-ink text-primary-foreground border-ink",
  rust: "bg-rust text-primary-foreground border-rust",
  success: "bg-success text-primary-foreground border-success",
  warning: "bg-warning text-primary-foreground border-warning",
  // NOTE: no plain `info` accent fill — `info` is the dotted status stamp
  // below. The -brutal/-glass compounds keep the accent forms.
  // Drafted offset (brutal)
  "ink-brutal": `bg-ink text-primary-foreground ${compactMaterials.brutal}`,
  "rust-brutal": `bg-rust text-primary-foreground ${compactMaterials.brutal}`,
  "success-brutal": `bg-success text-primary-foreground ${compactMaterials.brutal}`,
  "warning-brutal": `bg-warning text-primary-foreground ${compactMaterials.brutal}`,
  "info-brutal": `bg-info text-primary-foreground ${compactMaterials.brutal}`,
  // Sheet chips (legacy "glass" — opaque sheet + solid rule)
  "ink-glass": `${compactMaterials.glass} text-ink`,
  "rust-glass": `${compactMaterials.glass} text-rust`,
  "success-glass": `${compactMaterials.glass} text-success`,
  "warning-glass": `${compactMaterials.glass} text-warning`,
  "info-glass": `${compactMaterials.glass} text-info`,
} as const;

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden rounded-full border border-transparent font-body font-semibold leading-none whitespace-nowrap transition-all [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-primary-foreground",
        outline: "border-border text-foreground",
        // === Status stamps ===
        // State is carried by BORDER TREATMENT, not hue (monochrome system):
        // success = solid rule, warning = dashed, info = dotted,
        // danger = solid rust (the red pen — the one functional color).
        soft: "border-solid border-status-success bg-status-success-bg text-status-success",
        contrast: "bg-ink-950 text-paper-100 border-ink-950",
        warn: "border-dashed border-status-warning bg-status-warning-bg text-status-warning-ink",
        danger: "border-solid border-status-danger bg-status-danger-bg text-status-danger-ink",
        info: "border-dotted border-status-info bg-status-info-bg text-status-info",
        ...accentVariants,
      },
      size: {
        sm: "h-5 px-2 gap-1 text-xs [&>svg]:size-3!",
        default: "h-6 px-3 gap-1.5 text-sm [&>svg]:size-3.5!",
        lg: "h-7 px-3.5 gap-2 text-base [&>svg]:size-4!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
