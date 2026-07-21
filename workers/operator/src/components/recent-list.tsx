/**
 * Overview recent-item list (RFC-0001 wave-1 UX). Table-lite rows built on
 * @si/ui's `Item`/`ItemGroup`; each row renders as a router `Link` (passed in as
 * `link`) so the whole row jumps to the record's editor. A failed source panel
 * renders `error`; an empty-but-ok panel renders `empty`.
 */
import type { ReactElement, ReactNode } from "react";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@si/ui/components/item";

export interface RecentRow {
  key: string;
  title: string;
  subtitle?: string;
  /** Right-aligned trailing content — a status badge, amount, or timestamp. */
  meta?: ReactNode;
  /** A router `<Link>` element (no children); the row content renders inside it. */
  link: ReactElement;
}

export function RecentList({
  rows,
  empty,
  error,
}: {
  rows: RecentRow[];
  empty: string;
  error?: boolean;
}) {
  if (error) {
    return <p className="text-destructive font-mono text-xs">Couldn't load this panel — reload.</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground font-mono text-xs">{empty}</p>;
  }
  return (
    <ItemGroup className="gap-1.5">
      {rows.map((row) => (
        <Item key={row.key} variant="outline" size="sm" render={row.link}>
          <ItemContent>
            <ItemTitle>{row.title}</ItemTitle>
            {row.subtitle && <ItemDescription>{row.subtitle}</ItemDescription>}
          </ItemContent>
          {row.meta && <ItemActions>{row.meta}</ItemActions>}
        </Item>
      ))}
    </ItemGroup>
  );
}
