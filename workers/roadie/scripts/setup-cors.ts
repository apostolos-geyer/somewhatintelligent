/**
 * Apply CORS policy to Roadie's R2 buckets.
 *
 * Roadie presigns PUT/GET URLs that the browser hits directly against R2.
 * Without CORS, every client-direct upload/download from a Roadie consumer
 * app (transfers, etc.) fails the preflight. This script writes the single
 * canonical CORS policy per environment.
 *
 * Wildcard subdomains are intentional — any current or future Roadie
 * consumer app deployed under the respective domain gets access without a
 * script change.
 *
 * Uses wrangler CLI (must be authenticated via `wrangler login`).
 *
 * Usage:
 *   vp run cors:setup -- --env local
 *   vp run cors:setup -- --env staging
 *   vp run cors:setup -- --env production
 *   vp run cors:setup -- --env all
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

type Env = "local" | "staging" | "production";

const BUCKETS: Record<Env, string> = {
  local: "roadie-local-blobs",
  staging: "roadie-staging-blobs",
  production: "roadie-production-blobs",
};

const ORIGINS: Record<Env, string[]> = {
  local: ["https://*.somewhatintelligent.localhost"],
  staging: ["https://*.example-account.workers.dev"],
  production: ["https://*.somewhatintelligent.ca"],
};

// PUT — single-part uploads + multipart part uploads.
// GET — signed downloads with response-content-disposition overrides.
// HEAD — clients probing object existence before a retry.
const METHODS = ["GET", "PUT", "HEAD"];

// Content-Type + Content-Length are bound into the PUT signature.
// x-amz-content-sha256 is added by aws4fetch for signing.
// x-amz-checksum-sha256 is bound when enforceChecksum is true.
const ALLOWED_HEADERS = [
  "Content-Type",
  "Content-Length",
  "x-amz-content-sha256",
  "x-amz-checksum-sha256",
];

// ETag is required by multipart clients — each part's ETag must be read
// from the PUT response and sent back to Roadie via recordPart.
const EXPOSED_HEADERS = ["ETag"];

const MAX_AGE_SECONDS = 3600;

function corsPolicy(env: Env) {
  return {
    rules: [
      {
        allowed: {
          origins: ORIGINS[env],
          methods: METHODS,
          headers: ALLOWED_HEADERS,
        },
        exposeHeaders: EXPOSED_HEADERS,
        maxAgeSeconds: MAX_AGE_SECONDS,
      },
    ],
  };
}

function applyCors(env: Env) {
  const bucket = BUCKETS[env];
  const policy = corsPolicy(env);
  const tmpFile = join(tmpdir(), `roadie-cors-${env}-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(policy, null, 2));
  try {
    console.log(`[setup-cors] ${env}: applying to ${bucket}`);
    execSync(`vpx wrangler r2 bucket cors set ${bucket} --file ${tmpFile} --force`, {
      stdio: "inherit",
    });
    console.log(`  origins: ${ORIGINS[env].join(", ")}`);
    console.log(`  methods: ${METHODS.join(", ")}`);
  } finally {
    unlinkSync(tmpFile);
  }
}

const { values } = parseArgs({
  options: { env: { type: "string" } },
  strict: true,
});

const envArg = values.env;
if (!envArg) {
  console.error("Usage: --env <local|staging|production|all>");
  process.exit(1);
}

const targets: Env[] =
  envArg === "all"
    ? ["local", "staging", "production"]
    : envArg === "local" || envArg === "staging" || envArg === "production"
      ? [envArg]
      : (() => {
          console.error(`Invalid --env: ${envArg}. Must be local|staging|production|all.`);
          process.exit(1);
        })();

for (const env of targets) {
  applyCors(env);
}
console.log("\n[setup-cors] done");
