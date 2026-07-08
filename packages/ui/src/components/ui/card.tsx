import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";
import { surfaceMaterials } from "@si/ui/lib/materials";

const cardVariants = cva(
  "group/card flex flex-col gap-4 overflow-hidden rounded-md py-4 text-sm text-card-foreground has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
  {
    variants: {
      variant: {
        // Brand default: dashed hairline rule, no rounding, no shadow — the
        // negative-space grid line. Reuses the `soft` material so Card's
        // default finally rides the same material system as every other
        // variant instead of a bespoke solid+shadow string.
        default: surfaceMaterials.soft,
        soft: surfaceMaterials.soft,
        neo: surfaceMaterials.neo,
        "neo-inset": surfaceMaterials.neoInset,
        glass: surfaceMaterials.glass,
        // Dark tile: fixed graphite sheet, paper ink — flat, heavy rule.
        dark: "bg-ink-950 text-paper-100 border-2 border-ink-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Card({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-md border-b-2 border-dashed border-border px-4 pb-4 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:pb-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "type-display-title group-data-[size=sm]/card:text-lg group-data-[size=sm]/card:font-body group-data-[size=sm]/card:font-semibold",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-md border-t-2 border-dashed border-border bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  cardVariants,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
