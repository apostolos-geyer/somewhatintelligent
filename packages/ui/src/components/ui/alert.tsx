import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@greenroom/ui/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-md border-2 px-3 py-2.5 text-left text-sm font-editorial has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-surface-raised text-foreground",
        destructive:
          "border-stigma bg-stigma/10 text-stigma *:data-[slot=alert-description]:text-stigma/80",
        sprout:
          "border-sprout bg-sprout/10 text-sprout *:data-[slot=alert-description]:text-sprout/80",
        growth:
          "border-growth bg-growth/10 text-growth *:data-[slot=alert-description]:text-growth/80",
        pistil:
          "border-pistil bg-pistil/10 text-pistil *:data-[slot=alert-description]:text-pistil/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-semibold group-has-[>svg]/alert:col-start-2", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm text-muted-foreground [&_p:not(:last-child)]:mb-4", className)}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props} />
  );
}

export { Alert, alertVariants, AlertTitle, AlertDescription, AlertAction };
