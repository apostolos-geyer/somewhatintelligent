#!/usr/bin/env bun
// Idempotent local-dev seed (RFC-0001 "Local development"): the five fixed
// pages as editable DRAFT documents, with default copy matching the committed
// Astro placeholders in workers/site/src/pages. Fixed ids + INSERT OR IGNORE
// make re-runs a no-op. NO fake texts, software, or products — the RFC forbids
// seeding fake records. Local D1 only (see scripts/dev-config d1Exec).
import { resolve, dirname } from "node:path";
import { validatePageDocument, type PageDocumentByKey, type PageKey } from "@si/contracts/pages";
import { d1Exec } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const now = Date.now();
const SEED_SUB = "seed";

// Default page documents. Copy is lifted verbatim from the committed Astro
// placeholders (workers/site/src/pages/*), SEO from those pages' <Base> props
// and layout defaults.
const documents: { [K in PageKey]: PageDocumentByKey[K] } = {
  home: {
    schemaVersion: 1,
    key: "home",
    seo: {
      title: "somewhatintelligent — objects, systems, texts",
      description: "Objects, systems, texts, and other side effects by Apostoli.",
      imageMediaId: null,
    },
    tagline: "objects, texts, systems, & side effects",
    heroMediaId: null,
    sections: {
      objects: {
        eyebrow: "OBJECTS",
        body: "Hand made and algorithmically marketed. What better way to express your subversion than through consumption?",
        featuredProductId: null,
        actionLabel: "Shop now",
      },
      systems: {
        eyebrow: "SOFTWARE REGISTRY",
        body: "Digital solutions to problems created by digital solutions to problems. People used to live in longhouses. Now you want an MCP gateway.",
        featuredSoftwareId: null,
        actionLabel: "Explore systems",
      },
      texts: {
        eyebrow: "TEXTS",
        body: "Critical writing on technology, intimacy, and power. Or a catalog of my arrogance. Interpretation is left as an exercise to the reader.",
        featuredTextId: null,
        actionLabel: "Read texts",
      },
      about: {
        eyebrow: "ABOUT",
        body: "The mask behind the other, more abstract mask. Of course, the subject remains as obscured as ever.",
        actionLabel: "About",
      },
    },
  },
  shop: {
    schemaVersion: 1,
    key: "shop",
    seo: {
      title: "Objects — somewhatintelligent",
      description: "Versioned clothing and physical goods published by somewhatintelligent.",
      imageMediaId: null,
    },
    eyebrow: "OBJECTS",
    title: "OBJECTS",
    deck: "Artifacts for interface, code, and the public we build.",
    emptyMessage: "No objects are published yet.",
  },
  writing: {
    schemaVersion: 1,
    key: "writing",
    seo: {
      title: "Writing — somewhatintelligent",
      description: "Writing by Apostoli, published by somewhatintelligent.",
      imageMediaId: null,
    },
    eyebrow: "TEXTS",
    title: "WRITING",
    deck: "arguments, notes, and revisions",
    emptyMessage: "Writing records will appear here.",
  },
  software: {
    schemaVersion: 1,
    key: "software",
    seo: {
      title: "Software — somewhatintelligent",
      description:
        "Software and research systems by somewhatintelligent, with explicit access boundaries.",
      imageMediaId: null,
    },
    eyebrow: "SYSTEMS",
    title: "SYSTEMS",
    deck: "Software and research systems, with explicit access boundaries.",
    emptyMessage: "No systems are published yet.",
  },
  about: {
    schemaVersion: 1,
    key: "about",
    seo: {
      title: "Apostoli — somewhatintelligent",
      description:
        "Apostoli is the publisher, writer, and operator responsible for somewhatintelligent. Not for hire.",
      imageMediaId: null,
    },
    eyebrow: "ABOUT",
    title: "APOSTOLI",
    statement:
      "Why be curious? It is an act towards intimacy—a bid for connection—with one's own existence. It is an act of epistemic humility. No act is more profoundly intimate than the struggle to understand something outside oneself.\n\nThus, I am curious. I build systems because I like knowing how things work. I like being the one who decides how things work. I make art because I like having license to comment on how they already do. Should I be entrusted with such power? No less than anyone else should be entrusted to make such a judgement.",
    primaryMediaId: null,
    secondaryMediaId: null,
    lowerContent: "Selected work — coming soon.",
  },
};

// SQLite single-quote escaping for embedding a JSON string in a d1 --command.
const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

const pageKeys = Object.keys(documents) as PageKey[];
for (const key of pageKeys) {
  const validated = validatePageDocument(key, documents[key]);
  if (!validated.ok) {
    throw new Error(`seed: default document for "${key}" is invalid: ${validated.message}`);
  }
  const id = `page-${key}`;
  const documentJson = sqlString(JSON.stringify(validated.value));

  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO page_entry (id, page_key, active_release_id, created_at, updated_at)
     VALUES ('${id}', '${key}', NULL, ${now}, ${now});`,
  );
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO page_draft
       (page_id, revision, schema_version, document_json, updated_by_sub, updated_at)
     VALUES ('${id}', 1, 1, ${documentJson}, '${SEED_SUB}', ${now});`,
  );
}

console.log(`  [seed] workers/publisher: ${pageKeys.length} fixed-page draft documents ready`);
