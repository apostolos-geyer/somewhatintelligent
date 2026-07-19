/**
 * Shape a text listing into `[[wikilink]]` suggestions for the MarkdownField
 * autocomplete (RFC-0001 D13). Pure so the query→suggestion mapping is testable
 * without the server-fn / RPC layer; the `searchTexts` server fn wraps it.
 */
import type { WikilinkSuggestion } from "@si/ui/components/wikilink-autocomplete";

export function toWikilinkSuggestions(
  texts: ReadonlyArray<{ slug: string; title: string }>,
  query: string,
  limit = 8,
): WikilinkSuggestion[] {
  const q = query.trim().toLowerCase();
  const matched =
    q === ""
      ? texts
      : texts.filter((t) => t.slug.toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
  return matched.slice(0, limit).map((t) => ({ slug: t.slug, title: t.title }));
}
