import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-md border-2 px-3 py-2.5 text-left text-sm font-editorial has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Border treatment carries state (monochrome system):
        // default solid, ink solid, success solid, warning DASHED, info DOTTED,
        // destructive solid rust (the red pen).
        default: "border-border-strong bg-surface-raised text-foreground",
        destructive:
          "border-rust bg-rust/10 text-rust *:data-[slot=alert-description]:text-rust/80",
        ink: "border-ink bg-ink/5 text-ink *:data-[slot=alert-description]:text-ink/80",
        success:
          "border-success bg-success/5 text-success *:data-[slot=alert-description]:text-success/80",
        warning:
          "border-dashed border-warning bg-warning/5 text-warning *:data-[slot=alert-description]:text-warning/80",
        info: "border-dotted border-info bg-info/5 text-info *:data-[slot=alert-description]:text-info/80",
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
