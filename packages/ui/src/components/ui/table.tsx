import * as React from "react";

import { cn } from "@si/ui/lib/utils";

// The "sharp bordered table" pattern already used throughout the identity
// admin routes, extracted into a shared primitive. Solid, heavy-border
// container deliberately — tables are the highest-emphasis tier and stay
// solid even though Card's default has moved to a dashed rule.
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      className={cn(
        "relative w-full flex-1 overflow-x-auto border-2 border-border-strong",
        containerClassName,
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr data-slot="table-row" className={cn("border-b border-border", className)} {...props} />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "type-mono-label px-4 py-3 text-left font-normal text-text-tertiary",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-4 py-3", className)} {...props} />;
}

function TableEmpty({
  colSpan,
  className,
  children,
}: {
  colSpan: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableRow className="border-b-0">
      <TableCell colSpan={colSpan} className={cn("py-8 text-center text-text-tertiary", className)}>
        {children}
      </TableCell>
    </TableRow>
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmpty };
