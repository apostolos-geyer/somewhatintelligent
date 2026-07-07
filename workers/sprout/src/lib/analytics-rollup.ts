/**
 * PURE analytics rollup helpers — no `cloudflare:workers`, no env, no clock — so
 * the aggregation math is unit-testable in plain node (the server-fn that reads
 * D1 lives in `analytics.functions.ts` and pre-filters by brand/actor/window
 * before handing rows here).
 */

/** One raw event projection used by the rollup (no metadata — counts only). */
export interface RollupEvent {
  type: string;
  actorId: string;
  createdAt: number;
}

/** A single type → count pair. */
export interface TypeCount {
  type: string;
  count: number;
}

/**
 * Count events by `type`, sorted descending by count, ties broken ascending by
 * type name (stable, deterministic). Safe on an unfiltered array — it simply
 * counts whatever it is handed.
 */
export function rollupEvents(events: readonly RollupEvent[]): {
  total: number;
  byType: TypeCount[];
} {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const byType: TypeCount[] = [...counts.entries()]
    .map(([t, count]) => ({ type: t, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return { total: events.length, byType };
}
