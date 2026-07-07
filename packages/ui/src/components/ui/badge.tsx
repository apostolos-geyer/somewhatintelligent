import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@greenroom/ui/lib/utils";
import { compactMaterials } from "@greenroom/ui/lib/materials";

const accentVariants = {
  // Solid
  sprout: "bg-sprout text-primary-foreground border-sprout",
  stigma: "bg-stigma text-primary-foreground border-stigma",
  growth: "bg-growth text-primary-foreground border-growth",
  pistil: "bg-pistil text-primary-foreground border-pistil",
  haze: "bg-haze text-primary-foreground border-haze",
  // Brutalist
  "sprout-brutal": `bg-sprout text-primary-foreground ${compactMaterials.brutal}`,
  "stigma-brutal": `bg-stigma text-primary-foreground ${compactMaterials.brutal}`,
  "growth-brutal": `bg-growth text-primary-foreground ${compactMaterials.brutal}`,
  "pistil-brutal": `bg-pistil text-primary-foreground ${compactMaterials.brutal}`,
  "haze-brutal": `bg-haze text-primary-foreground ${compactMaterials.brutal}`,
  // Glass
  "sprout-glass": `${compactMaterials.glass} text-sprout`,
  "stigma-glass": `${compactMaterials.glass} text-stigma`,
  "growth-glass": `${compactMaterials.glass} text-growth`,
  "pistil-glass": `${compactMaterials.glass} text-pistil`,
  "haze-glass": `${compactMaterials.glass} text-haze`,
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
        // === Sprout tone scale (status pills) ===
        // Soft success: green-tinted bg, growth ink — the default-feel chip.
        soft: "bg-success-bg text-growth",
        // Lime on dark: Indica fill, bright Sprout-Green ink.
        lime: "bg-indica-green text-sprout-green",
        // Warn: Pistil amber.
        warn: "bg-warning-bg text-warning-ink",
        // Danger: Stigma terracotta.
        danger: "bg-danger-bg text-danger-ink",
        // Info: Purple Haze.
        info: "bg-info-bg text-info",
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
