#!/usr/bin/env bun
// Idempotent local-dev seed (RFC-0001 "Local development"): the five fixed
// pages as editable DRAFT documents, with default copy matching the committed
// Astro placeholders in workers/site/src/pages. Fixed ids + INSERT OR IGNORE
// make re-runs a no-op. NO fake texts, software, or products — the RFC forbids
// seeding fake records. Local D1 only (see scripts/dev-config d1Exec).
import { resolve, dirname } from "node:path";
import { validatePageDocument, type PageKey } from "@si/contracts/pages";
import { DEFAULT_PAGE_DOCUMENTS } from "../src/lib/default-page-documents";
import { d1Exec } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const now = Date.now();
const SEED_SUB = "seed";

// Default page documents. Copy is lifted verbatim from the committed Astro
// placeholders (workers/site/src/pages/*), SEO from those pages' <Base> props
// and layout defaults. Shared with the T17 validation tests so the same
// committed documents both seed and prove valid.
const documents = DEFAULT_PAGE_DOCUMENTS;

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
