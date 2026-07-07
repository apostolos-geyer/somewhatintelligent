"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@greenroom/ui/lib/utils";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";

// Sprout brand buttons are FULLY PILL with a quick, gentle press.
// Transitions are 150–200ms ease-out; active state scales to 0.97 (the
// signature reward-moment spring). Focus is a 3px soft Growth ring.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-150 ease-out outline-none select-none active:scale-[0.97] focus-visible:ring-3 focus-visible:ring-growth/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Default = Primary (signature): brand primary fill + on-accent ink.
        // Semantic tokens so a tenant's --color-sprout retint reaches every button.
        default: "bg-sprout text-primary-foreground hover:bg-sprout-hover",
        // Strong: Growth fill + on-accent ink + brand glow, darken on hover.
        strong: "bg-growth text-primary-foreground shadow-brand hover:bg-growth-hover",
        // Outline: transparent, growth ink, 1.5px brand border.
        outline:
          "border-[1.5px] border-border bg-transparent text-growth hover:bg-success-bg active:scale-[0.97]",
        // Ghost / text only: growth ink, gentle tint on hover.
        ghost: "bg-transparent text-growth hover:bg-success-bg active:scale-[0.97]",
        // Dark: fixed Indica surface + cream ink — a deliberately always-dark control.
        dark: "bg-indica-green text-cream hover:bg-forest-900",
        // Destructive (Stigma terracotta).
        destructive: "bg-stigma text-primary-foreground hover:bg-stigma-hover",
        // Link.
        link: "text-growth underline-offset-4 hover:underline",

        // === Backwards-compatible / platform variants ===
        // Secondary: soft elevated surface card.
        secondary: `bg-card text-foreground ${interactiveMaterials.soft} rounded-full`,
        // Neumorphic — carved from surface.
        neo: `bg-secondary text-foreground ${interactiveMaterials.neo} rounded-full`,
        // Glass — frosted translucent with soft shadow.
        glass: `text-foreground ${interactiveMaterials.glass} rounded-full`,
        // Success (Growth) — alias of strong's palette without the glow.
        success: "bg-growth text-primary-foreground hover:bg-growth-hover",
      },
      size: {
        // Brand kit: sm 9×16 / md 13×22 / lg 16×26; font 13/15/17.
        default: "h-11 gap-2 px-[22px] text-[15px]",
        xs: "h-7 gap-1 px-3 text-xs",
        sm: "h-9 gap-1.5 px-4 text-[13px]",
        lg: "h-13 gap-2 px-[26px] text-[17px]",
        xl: "h-14 gap-2 px-8 text-lg",
        icon: "size-11",
        "icon-sm": "size-9",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
