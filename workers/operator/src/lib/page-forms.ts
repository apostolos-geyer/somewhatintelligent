/**
 * Default page documents per {@link PageKey} (RFC-0001 D9). When `getPage`
 * returns `not_found`, the editor seeds a blank-but-valid document of the right
 * discriminated-union shape so the operator edits copy rather than authoring
 * JSON. Pure and typed so the shapes stay faithful to `@si/contracts/pages`.
 */
import type { PageDocumentByKey, PageKey } from "@si/contracts";

const emptySeo = { title: "", description: "", imageMediaId: null };

const DEFAULTS: { [K in PageKey]: PageDocumentByKey[K] } = {
  home: {
    schemaVersion: 1,
    key: "home",
    seo: { ...emptySeo },
    tagline: "",
    heroMediaId: null,
    sections: {
      objects: { eyebrow: "OBJECTS", body: "", featuredProductId: null, actionLabel: "" },
      systems: {
        eyebrow: "SOFTWARE REGISTRY",
        body: "",
        featuredSoftwareId: null,
        actionLabel: "",
      },
      texts: { eyebrow: "TEXTS", body: "", featuredTextId: null, actionLabel: "" },
      about: { eyebrow: "ABOUT", body: "", actionLabel: "" },
    },
  },
  shop: {
    schemaVersion: 1,
    key: "shop",
    seo: { ...emptySeo },
    eyebrow: "OBJECTS",
    title: "",
    deck: "",
    emptyMessage: "",
  },
  writing: {
    schemaVersion: 1,
    key: "writing",
    seo: { ...emptySeo },
    eyebrow: "TEXTS",
    title: "",
    deck: "",
    emptyMessage: "",
  },
  software: {
    schemaVersion: 1,
    key: "software",
    seo: { ...emptySeo },
    eyebrow: "SYSTEMS",
    title: "",
    deck: "",
    emptyMessage: "",
  },
  about: {
    schemaVersion: 1,
    key: "about",
    seo: { ...emptySeo },
    eyebrow: "ABOUT",
    title: "",
    statement: "",
    primaryMediaId: null,
    secondaryMediaId: null,
    lowerContent: "",
  },
};

/** A fresh, valid, empty document for `key` — a new object each call (no shared refs). */
export function defaultPageDocument<K extends PageKey>(key: K): PageDocumentByKey[K] {
  return structuredClone(DEFAULTS[key]);
}

/**
 * Every media reference declared in a page document, labelled by its slot. Page
 * documents reference media by id (`getPage` returns no `PublisherMediaDTO`
 * array), so the Media browser reads these to offer delete-by-mediaId.
 */
export function pageDocumentMediaRefs(
  document: PageDocumentByKey[PageKey],
): Array<{ slot: string; mediaId: string }> {
  const refs: Array<{ slot: string; mediaId: string | null }> = [
    { slot: "seo.imageMediaId", mediaId: document.seo.imageMediaId },
  ];
  if (document.key === "home") {
    refs.push({ slot: "heroMediaId", mediaId: document.heroMediaId });
  } else if (document.key === "about") {
    refs.push({ slot: "primaryMediaId", mediaId: document.primaryMediaId });
    refs.push({ slot: "secondaryMediaId", mediaId: document.secondaryMediaId });
  }
  return refs.filter((r): r is { slot: string; mediaId: string } => r.mediaId !== null);
}

export const PAGE_KEYS: readonly PageKey[] = ["home", "shop", "writing", "software", "about"];

export const PAGE_KEY_LABELS: Record<PageKey, string> = {
  home: "Home",
  shop: "Shop",
  writing: "Writing",
  software: "Software",
  about: "About",
};
