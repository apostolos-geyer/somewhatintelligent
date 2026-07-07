"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";
import { interactiveMaterials } from "@si/ui/lib/materials";

// Blueprint buttons are FULLY PILL with a quick, crisp press.
// Transitions are 150–200ms ease-out; active state scales to 0.97. Focus is
// a 2px solid ink ring offset from the control — a drafted focus rectangle,
// never a soft glow.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full text-sm font-semibold whitespace-nowrap transition-all duration-150 ease-out outline-none select-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Default = Primary: solid ink fill + paper text. Semantic tokens so
        // a tenant's --color-ink retint reaches every button.
        default: "bg-ink text-primary-foreground hover:bg-ink-hover",
        // Strong: ink fill + drafted offset — the hero CTA stands off the paper.
        strong:
          "bg-ink text-primary-foreground shadow-brutal-sm hover:bg-ink-hover hover:shadow-brutal-md",
        // Outline: transparent, ink text, heavy 1.5px rule.
        outline:
          "border-[1.5px] border-border-strong bg-transparent text-foreground hover:bg-surface-sunken active:scale-[0.97]",
        // Ghost / text only: ink text, recessed-paper tint on hover.
        ghost: "bg-transparent text-foreground hover:bg-surface-sunken active:scale-[0.97]",
        // Dark: fixed graphite surface + paper ink — a deliberately always-dark control.
        dark: "bg-ink-950 text-paper-100 hover:bg-ink-800",
        // Destructive — the red pen.
        destructive: "bg-rust text-primary-foreground hover:bg-rust-hover",
        // Link: dotted annotation underline that commits to solid on hover.
        link: "text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid",

        // === Backwards-compatible / platform variants ===
        // Secondary: quiet dashed-rule surface.
        secondary: `bg-card text-foreground ${interactiveMaterials.soft} rounded-full`,
        // Neumorphic — chiseled from the paper.
        neo: `bg-secondary text-foreground ${interactiveMaterials.neo} rounded-full`,
        // Legacy "glass" — opaque fresh sheet with a solid rule.
        glass: `text-foreground ${interactiveMaterials.glass} rounded-full`,
        // Success — confirmation ink (dark gray; state also carried by copy/icon).
        success: "bg-success text-primary-foreground hover:bg-success-hover",
      },
      size: {
        // Kit: sm 9×16 / md 13×22 / lg 16×26; font 13/15/17.
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
