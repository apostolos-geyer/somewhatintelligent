import { type } from "arktype";

import { err, ok, type DomainResult } from "./result";

/**
 * Fixed page-document contracts (RFC-0001 D9 + "Fixed page document
 * contracts"). Publisher stores one versioned discriminated-union document per
 * page key. The operator edits copy, chooses media, selects featured records,
 * and orders declared slots — it CANNOT enter arbitrary component names, CSS,
 * JavaScript, JSX, or raw HTML. {@link validatePageDocument} enforces that at
 * the write/read boundary (INV-PAGE-1) by rejecting undeclared keys.
 */
export type PageKey = "home" | "shop" | "writing" | "software" | "about";

export interface PageDocumentBase<K extends PageKey> {
  schemaVersion: 1;
  key: K;
  seo: {
    title: string;
    description: string;
    imageMediaId: string | null;
  };
}

export interface HomeDocumentV1 extends PageDocumentBase<"home"> {
  tagline: string;
  heroMediaId: string | null;
  sections: {
    objects: {
      eyebrow: "OBJECTS";
      body: string;
      featuredProductId: string | null;
      actionLabel: string;
    };
    systems: {
      eyebrow: "SOFTWARE REGISTRY";
      body: string;
      featuredSoftwareId: string | null;
      actionLabel: string;
    };
    texts: {
      eyebrow: "TEXTS";
      body: string;
      featuredTextId: string | null;
      actionLabel: string;
    };
    about: {
      eyebrow: "ABOUT";
      body: string;
      actionLabel: string;
    };
  };
}

export interface ShopDocumentV1 extends PageDocumentBase<"shop"> {
  eyebrow: "OBJECTS";
  title: string;
  deck: string;
  emptyMessage: string;
}

export interface WritingDocumentV1 extends PageDocumentBase<"writing"> {
  eyebrow: "TEXTS";
  title: string;
  deck: string;
  emptyMessage: string;
}

export interface SoftwareDocumentV1 extends PageDocumentBase<"software"> {
  eyebrow: "SYSTEMS";
  title: string;
  deck: string;
  emptyMessage: string;
}

export interface AboutDocumentV1 extends PageDocumentBase<"about"> {
  eyebrow: "ABOUT";
  title: string;
  statement: string;
  primaryMediaId: string | null;
  secondaryMediaId: string | null;
  lowerContent: string;
}

export interface PageDocumentByKey {
  home: HomeDocumentV1;
  shop: ShopDocumentV1;
  writing: WritingDocumentV1;
  software: SoftwareDocumentV1;
  about: AboutDocumentV1;
}

// --- runtime validators (arktype) ------------------------------------------
// `"+": "reject"` makes each object reject undeclared keys, so authored content
// cannot smuggle component/HTML/style/script fields past the document type.

const seoSchema = type({
  "+": "reject",
  title: "string <= 200",
  description: "string <= 400",
  imageMediaId: "string | null",
});

export const homeDocument = type({
  "+": "reject",
  schemaVersion: "1",
  key: "'home'",
  seo: seoSchema,
  tagline: "string <= 400",
  heroMediaId: "string | null",
  sections: {
    "+": "reject",
    objects: {
      "+": "reject",
      eyebrow: "'OBJECTS'",
      body: "string <= 2000",
      featuredProductId: "string | null",
      actionLabel: "string <= 80",
    },
    systems: {
      "+": "reject",
      eyebrow: "'SOFTWARE REGISTRY'",
      body: "string <= 2000",
      featuredSoftwareId: "string | null",
      actionLabel: "string <= 80",
    },
    texts: {
      "+": "reject",
      eyebrow: "'TEXTS'",
      body: "string <= 2000",
      featuredTextId: "string | null",
      actionLabel: "string <= 80",
    },
    about: {
      "+": "reject",
      eyebrow: "'ABOUT'",
      body: "string <= 2000",
      actionLabel: "string <= 80",
    },
  },
});

export const shopDocument = type({
  "+": "reject",
  schemaVersion: "1",
  key: "'shop'",
  seo: seoSchema,
  eyebrow: "'OBJECTS'",
  title: "string <= 120",
  deck: "string <= 400",
  emptyMessage: "string <= 400",
});

export const writingDocument = type({
  "+": "reject",
  schemaVersion: "1",
  key: "'writing'",
  seo: seoSchema,
  eyebrow: "'TEXTS'",
  title: "string <= 120",
  deck: "string <= 400",
  emptyMessage: "string <= 400",
});

export const softwareDocument = type({
  "+": "reject",
  schemaVersion: "1",
  key: "'software'",
  seo: seoSchema,
  eyebrow: "'SYSTEMS'",
  title: "string <= 120",
  deck: "string <= 400",
  emptyMessage: "string <= 400",
});

export const aboutDocument = type({
  "+": "reject",
  schemaVersion: "1",
  key: "'about'",
  seo: seoSchema,
  eyebrow: "'ABOUT'",
  title: "string <= 120",
  statement: "string <= 4000",
  primaryMediaId: "string | null",
  secondaryMediaId: "string | null",
  lowerContent: "string <= 8000",
});

export const pageDocumentSchemas = {
  home: homeDocument,
  shop: shopDocument,
  writing: writingDocument,
  software: softwareDocument,
  about: aboutDocument,
} as const;

// Compile-time guard: each validator's inferred output must be assignable to
// the corresponding hand-written interface, so the runtime schema never drifts
// looser than the type. (Fails `tsgo` if a schema and its interface diverge.)
type _AssertHome = typeof homeDocument.infer extends HomeDocumentV1 ? true : never;
type _AssertShop = typeof shopDocument.infer extends ShopDocumentV1 ? true : never;
type _AssertWriting = typeof writingDocument.infer extends WritingDocumentV1 ? true : never;
type _AssertSoftware = typeof softwareDocument.infer extends SoftwareDocumentV1 ? true : never;
type _AssertAbout = typeof aboutDocument.infer extends AboutDocumentV1 ? true : never;
const _assertions: [_AssertHome, _AssertShop, _AssertWriting, _AssertSoftware, _AssertAbout] = [
  true,
  true,
  true,
  true,
  true,
];
void _assertions;

/**
 * Validate an untrusted document against the schema for `key`, rejecting any
 * unknown field. Returns a {@link DomainResult}: `ok` with the typed document,
 * or the `invalid_document` error with an arktype summary.
 */
export function validatePageDocument<K extends PageKey>(
  key: K,
  value: unknown,
): DomainResult<PageDocumentByKey[K], "invalid_document"> {
  const schema = pageDocumentSchemas[key] as (data: unknown) => unknown;
  const out = schema(value);
  if (out instanceof type.errors) {
    return err("invalid_document", out.summary);
  }
  return ok(out as PageDocumentByKey[K]);
}
