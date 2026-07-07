#!/usr/bin/env bun
/**
 * THE seed — one script that seeds EVERYTHING we have demo data for (users,
 * orgs, brand skins, portal config, hero slides, portal members, products,
 * decks, assets, reviews, feed, chat, booking, quizzes, banners, scores,
 * awards, AI/analytics/notifications) against a chosen deployment:
 *
 *   bun scripts/seed.ts                    # local dev D1 (default)
 *   bun scripts/seed.ts --target staging   # deployed staging (remote D1 + R2)
 *
 * Consolidates the old seed-demo / seed-e2e / seed-staging /
 * seed-staging-content / seed-mtl scripts into one entry point. Idempotent:
 * identity rows are keyed (INSERT OR REPLACE / OR IGNORE), content rows are
 * prefix-scoped (`seed_` / `demo_` / `mtl_`) and delete-then-inserted, so
 * re-running clobbers ONLY seed-owned rows. Theme + portal config rows are
 * overwritten by design (they're demo data, not user content).
 *
 * Users/orgs live in guestlist:
 *  - local: spawns guestlist's own `scripts/seed.ts` (which defers cleanly when
 *    the dev stack isn't up — re-run after `bun run dev`).
 *  - staging: converges the demo logins onto ONE password via better-auth
 *    sign-up at identity-staging (guestlist `scripts/seed-users.ts`), then
 *    writes orgs + memberships straight into remote D1.
 *
 * Sprout rows target the SPLIT config model: `brand_theme` (skin, draft/live)
 * + `portal_config` (name/tagline/feed label/sections, live-edit) +
 * `hero_slides` — the three write paths the admin UI edits.
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { DEV_SPAWN_ENV, d1Exec, d1Query, type D1Target } from "../../../scripts/dev-config";
import { DEMO_BRANDS } from "../__tests__/demo-constants";

// ─── CLI / target ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const targetName = argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : "local";
if (targetName !== "local" && targetName !== "staging") {
  console.error(`[seed] unknown --target "${targetName}" (expected: local | staging)`);
  process.exit(1);
}
const staging = targetName === "staging";
const ENV = "staging";
const target: D1Target | undefined = staging ? { remote: true, env: ENV } : undefined;

const pkgDir = resolve(dirname(import.meta.path), ".."); // workers/sprout
const guestlistDir = resolve(pkgDir, "../../workers/guestlist");
const roadieDir = resolve(pkgDir, "../../workers/roadie");
const assetsDir = resolve(pkgDir, "scripts/mtl-assets");
const deckAssetsDir = resolve(pkgDir, "scripts/deck-assets");

const esc = (s: string): string => s.replace(/'/g, "''");
const uuid = (): string => crypto.randomUUID();
const now = Date.now();
const NOW = "CAST(strftime('%s','now') AS INTEGER)*1000";
const FUT = (s: number) => `(CAST(strftime('%s','now') AS INTEGER)+${s})*1000`;
const PAST = (s: number) => `(CAST(strftime('%s','now') AS INTEGER)-${s})*1000`;
const period = new Date().toISOString().slice(0, 7); // YYYY-MM
const prevPeriod = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
})();

const sx = (sql: string): void => d1Exec(pkgDir, sql, target);
const gx = (sql: string): void => d1Exec(guestlistDir, sql, target);
const gq = <T = Record<string, unknown>>(sql: string): T[] => d1Query<T>(guestlistDir, sql, target);

function run(label: string, cmd: string, args: string[], cwd: string): void {
  console.log(`\n[seed] ${label}`);
  // Extend PATH with the workspace bin dir: sub-seeds shell out to `vp`/
  // `wrangler`, which resolve from node_modules/.bin when invoked via
  // `bun run` but not from a bare spawn.
  const binDir = resolve(pkgDir, "../../node_modules/.bin");
  const env = { ...DEV_SPAWN_ENV, PATH: `${binDir}:${DEV_SPAWN_ENV.PATH ?? process.env.PATH}` };
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

console.log(`[seed] target: ${targetName}`);

// ═══ 1. users + orgs + memberships (guestlist) ════════════════════════════════

const PW = "apostoli123";
const STAGING_IDENTITY_URL = "https://identity-staging.sproutportal.ca";

if (staging) {
  // super = platform admin (role on the user row, god-mode). The rest are plain
  // users whose authority comes from their org membership (below).
  const users = [
    { email: "admin@sproutportal.ca", password: PW, name: "Sprout Demo Admin", role: "user" },
    { email: "alice@example.com", password: PW, name: "Alice", role: "user" },
    { email: "bob@example.com", password: PW, name: "Bob", role: "user" },
    { email: "dave@example.com", password: PW, name: "Dave", role: "user" },
    { email: "super@user.com", password: PW, name: "Super", role: "admin" },
  ];

  // better-auth sign-up is a no-op for an existing email, so demo accounts are
  // untouched on re-runs. The lone exception is super@user.com: it may pre-exist
  // with a different password and BA has no "set password" via sign-up — the only
  // way to converge it onto the uniform password is delete-then-recreate. It owns
  // no memberships and the content below re-binds by email, so this is safe.
  console.log("[seed] converging super@user.com onto the uniform password…");
  for (const tbl of ["session", "account", "member"]) {
    gx(`DELETE FROM ${tbl} WHERE user_id IN (SELECT id FROM user WHERE email='super@user.com');`);
  }
  gx(`DELETE FROM user WHERE email='super@user.com';`);

  run(
    "create/affirm users via better-auth sign-up (no-op for existing accounts)",
    "bun",
    [
      "scripts/seed-users.ts",
      "--remote",
      "--env",
      ENV,
      "--url",
      STAGING_IDENTITY_URL,
      JSON.stringify(users),
    ],
    guestlistDir,
  );
} else {
  // Local: guestlist's own seed handles users/orgs/memberships (and defers
  // cleanly if the dev stack isn't serving yet).
  run("guestlist demo users/orgs (local)", "bun", ["scripts/seed.ts"], guestlistDir);
}

// Orgs exist on both targets (INSERT OR IGNORE — the local guestlist seed
// already made acme/beta; mtl exists only as data, no dedicated login flow).
console.log("\n[seed] orgs (acme/beta/mtl)…");
for (const o of [
  { id: "acme", name: "Acme Cannabis", slug: "acme" },
  { id: "beta", name: "Beta Greens", slug: "beta" },
  { id: "mtl", name: "MTL Cannabis", slug: "mtl" },
]) {
  gx(
    `INSERT OR IGNORE INTO organization (id, name, slug, logo, created_at, metadata) ` +
      `VALUES ('${o.id}','${o.name}','${o.slug}',NULL,${now},NULL);`,
  );
}

// ─── resolve real ids (org by slug, users by email) ──────────────────────────
const orgRows = gq<{ id: string; slug: string }>(
  `SELECT id, slug FROM organization WHERE slug IN ('acme','beta','mtl');`,
);
const orgBySlug = new Map(orgRows.map((r) => [r.slug, r.id] as const));
const acme = orgBySlug.get("acme") ?? "acme";
const beta = orgBySlug.get("beta") ?? "beta";
const mtl = orgBySlug.get("mtl") ?? "mtl";

const emails = [
  "admin@sproutportal.ca",
  "alice@example.com",
  "bob@example.com",
  "dave@example.com",
  "super@user.com",
];
const userRows = gq<{ id: string; email: string }>(
  `SELECT id, email FROM user WHERE email IN (${emails.map((e) => `'${esc(e)}'`).join(",")});`,
);
const idByEmail = new Map(userRows.map((r) => [r.email, r.id] as const));
const admin = idByEmail.get("admin@sproutportal.ca") ?? "admin";
const alice = idByEmail.get("alice@example.com") ?? "alice";
const bob = idByEmail.get("bob@example.com") ?? "bob";
const dave = idByEmail.get("dave@example.com") ?? "dave";
const sup = idByEmail.get("super@user.com") ?? "super";
const mtlAdmin = idByEmail.get("admin@sproutportal.ca") ?? bob;

// Staging memberships: org staff only; bob stays a budtender (portal member).
if (staging) {
  console.log("\n[seed] staging org memberships…");
  const memberships = [
    { email: "admin@sproutportal.ca", org: acme, role: "admin" },
    { email: "alice@example.com", org: acme, role: "admin" },
    { email: "dave@example.com", org: beta, role: "admin" },
  ];
  const bobId = idByEmail.get("bob@example.com");
  if (bobId) gx(`DELETE FROM member WHERE user_id='${bobId}';`); // converge: bob is never org staff
  for (const m of memberships) {
    const userId = idByEmail.get(m.email);
    if (!userId) throw new Error(`missing user id for ${m.email}`);
    const existing = gq<{ id: string }>(
      `SELECT id FROM member WHERE organization_id='${m.org}' AND user_id='${userId}';`,
    );
    if (existing.length === 0) {
      gx(
        `INSERT INTO member (id, organization_id, user_id, role, created_at) ` +
          `VALUES ('${uuid()}','${m.org}','${userId}','${m.role}',${now});`,
      );
      console.log(`  member: ${m.email} → ${m.org} (${m.role})`);
    }
  }
}

// ═══ 2. brand skins + portal config + hero slides + portal members ════════════

/** A self-contained gradient hero image (brand colours) — no R2 needed. */
function heroDataUri(primary: string, accent: string, idx: number): string {
  const a = [
    { x1: 0, y1: 0, x2: 1, y2: 1 },
    { x1: 1, y1: 0, x2: 0, y2: 1 },
    { x1: 0, y1: 1, x2: 1, y2: 0 },
  ][idx % 3]!;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">` +
    `<defs><linearGradient id="g" x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}">` +
    `<stop offset="0" stop-color="${primary}"/><stop offset="1" stop-color="${accent}"/>` +
    `</linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Upsert the per-brand config rows on the SPLIT model: directory mirror, theme
 * (draft+live clobbered — seed data, not user content), live-edit portal config. */
function seedBrandConfig(b: {
  orgId: string;
  slug: string;
  name: string;
  tagline: string;
  themeJson: string;
  logoRef: string | null;
  feedLabel: string;
}): void {
  const logo = b.logoRef ? `'${esc(b.logoRef)}'` : "NULL";
  sx(
    `INSERT OR REPLACE INTO org_brand_directory (org_id, slug, name, logo_ref, synced_at) ` +
      `VALUES ('${esc(b.orgId)}','${esc(b.slug)}','${esc(b.name)}',${logo},${now});`,
  );
  sx(
    `INSERT OR REPLACE INTO brand_theme ` +
      `(id, org_id, live_theme_json, draft_theme_json, state, live_published_at, created_at, updated_at) ` +
      `VALUES ('bt_${esc(b.slug)}','${esc(b.orgId)}','${esc(b.themeJson)}','${esc(b.themeJson)}','live',${now},${now},${now});`,
  );
  sx(
    `INSERT OR REPLACE INTO portal_config ` +
      `(id, org_id, name, tagline, logo_ref, sections_json, feed_label, created_at, updated_at) ` +
      `VALUES ('pc_${esc(b.slug)}','${esc(b.orgId)}','${esc(b.name)}','${esc(b.tagline)}',${logo},'[]','${esc(b.feedLabel)}',${now},${now});`,
  );
}

// Drop any prior synthetic demo brands so re-keying to real orgs leaves no orphans.
sx(`DELETE FROM hero_slides WHERE brand_id LIKE 'org_demo_%';`);
sx(`DELETE FROM brand_theme WHERE org_id LIKE 'org_demo_%';`);
sx(`DELETE FROM portal_config WHERE org_id LIKE 'org_demo_%';`);
sx(`DELETE FROM org_brand_directory WHERE org_id LIKE 'org_demo_%';`);

// Acme + Beta — the two demo skins (v1 theme shape; parseBrandTheme migrates).
for (const b of DEMO_BRANDS) {
  const orgId = orgBySlug.get(b.slug) ?? b.orgId;
  seedBrandConfig({
    orgId,
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    themeJson: JSON.stringify({ colors: b.theme.colors }),
    logoRef: null,
    feedLabel: "Enter the Grow",
  });
  sx(`DELETE FROM hero_slides WHERE brand_id = '${esc(orgId)}';`);
  b.heroSlides.forEach((s, i) => {
    const img = esc(heroDataUri(b.theme.colors.primary, b.theme.colors.accent, i));
    sx(
      `INSERT INTO hero_slides (id, brand_id, image_ref, category, headline, order_idx, enabled, created_at) ` +
        `VALUES ('hs_${esc(b.slug)}_${i}', '${esc(orgId)}', '${img}', '${esc(s.category)}', '${esc(s.headline)}', ${i}, 1, ${now});`,
    );
  });
  console.log(`  [seed] brand ${b.slug} → ${orgId} (${b.heroSlides.length} hero slides)`);
}

// ─── MTL Cannabis — the DARK third skin (matches the mtl-budtender mockup) ────
// Staging pushes the real logo/hero images into R2 via a from-scratch "roadie
// put"; local uses self-contained gradient art (roadie is inert without R2).
const MTL_THEME = {
  modePolicy: "fixed",
  fixedMode: "dark",
  light: {
    bg: "#080808",
    surface: "#101010",
    "surface-raised": "#181818",
    "surface-sunken": "#050505",
    border: "rgba(123,194,78,0.16)",
    "border-strong": "rgba(123,194,78,0.34)",
    text: "#ffffff",
    "text-secondary": "rgba(255,255,255,0.62)",
    "text-tertiary": "rgba(255,255,255,0.40)",
    "text-on-accent": "#07120a",
    sprout: "#7BC24E",
    "sprout-hover": "#98FE98",
    growth: "#7BC24E",
    "growth-hover": "#98FE98",
    haze: "#98FE98",
    pistil: "#e0b64e",
    stigma: "#e0673d",
  },
  radius: { xs: "2px", sm: "4px", md: "8px", lg: "10px", xl: "14px" },
  // Families must EXACTLY match a GOOGLE_FONTS catalog stack (lib/google-fonts.ts)
  // or BrandFonts won't load them (findGoogleFont is a strict stack lookup).
  fonts: {
    display: "'Bebas Neue', sans-serif",
    body: "'Outfit', sans-serif",
    mono: "'DM Mono', monospace",
  },
};

// From-scratch "roadie put": bytes → R2 + physical_blob + blob_reference,
// exactly what roadie's `put` RPC does — so *_ref columns hold genuine roadie
// referenceIds that `getReadUrl` signs at render time. Staging-only (needs R2).
const R2_ACCOUNT = "30ce6004cd9c2907f0b06fe401c4f4ba";
const ROADIE_BUCKET = "roadie-staging-blobs";
async function sha256hex(buf: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function roadiePut(
  file: string,
  contentType: string,
  resourceType: string,
  resourceId: string,
): Promise<string> {
  const bytes = new Uint8Array(readFileSync(file));
  const hash = await sha256hex(bytes);
  const size = bytes.length;

  const existing = d1Query<{ id: string }>(
    roadieDir,
    `SELECT id FROM physical_blob WHERE hash='${hash}' AND deleted_at IS NULL LIMIT 1;`,
    target,
  );
  let physId: string;
  if (existing[0]) {
    physId = existing[0].id;
  } else {
    physId = uuid();
    const r = spawnSync(
      "bunx",
      [
        "wrangler",
        "r2",
        "object",
        "put",
        `${ROADIE_BUCKET}/${physId}`,
        "--file",
        file,
        "--content-type",
        contentType,
        "--remote",
      ],
      {
        cwd: roadieDir,
        stdio: "inherit",
        env: { ...DEV_SPAWN_ENV, CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT },
      },
    );
    if (r.status !== 0) throw new Error(`r2 put failed for ${file}`);
    d1Exec(
      roadieDir,
      `INSERT INTO physical_blob (id,hash,size,upload_mode,part_size,part_count,r2_upload_id,enforce_checksum,refcount,created_at,finalized_at,deleted_at) ` +
        `VALUES ('${physId}','${hash}',${size},'server',NULL,NULL,NULL,0,1,${now},${now},NULL);`,
      target,
    );
  }
  d1Exec(
    roadieDir,
    `INSERT OR IGNORE INTO blob_reference (id,physical_blob_id,app,resource_type,resource_id,caller_app,content_type,created_at) ` +
      `VALUES ('${uuid()}','${physId}','sprout','${esc(resourceType)}','${esc(resourceId)}','sprout','${esc(contentType)}',${now});`,
    target,
  );
  const ref = d1Query<{ id: string }>(
    roadieDir,
    `SELECT id FROM blob_reference WHERE physical_blob_id='${physId}' AND app='sprout' AND resource_type='${esc(resourceType)}' AND resource_id='${esc(resourceId)}' LIMIT 1;`,
    target,
  );
  if (!ref[0]) throw new Error(`blob_reference lookup failed for ${resourceType}/${resourceId}`);
  console.log(`  [roadie] ${resourceType}/${resourceId} → ref ${ref[0].id} (blob ${physId})`);
  return ref[0].id;
}

let mtlLogoRef: string | null = null;
let mtlHeroRef: string;
if (staging && existsSync(`${assetsDir}/logo.png`)) {
  console.log("\n[seed] uploading MTL images to R2 (roadie refs)…");
  mtlLogoRef = await roadiePut(`${assetsDir}/logo.png`, "image/png", "brand-logo", "mtl");
  mtlHeroRef = await roadiePut(`${assetsDir}/hero.jpg`, "image/jpeg", "hero-slide", "mtl-montreal");
} else {
  mtlHeroRef = heroDataUri("#7BC24E", "#080808", 0);
}

seedBrandConfig({
  orgId: mtl,
  slug: "mtl",
  name: "MTL Cannabis",
  tagline: "Cannabis without compromises.",
  themeJson: JSON.stringify(MTL_THEME),
  logoRef: mtlLogoRef,
  feedLabel: "Enter the Grow",
});
sx(`DELETE FROM hero_slides WHERE brand_id='${esc(mtl)}';`);
(
  [
    ["Montreal Cultivated", "Committed to the Craft"],
    ["From Legacy to Legal · Since 2016", "Every Batch Builds Legacy"],
    ["Genetics · Community · Excellence", "Cannabis Without Compromises"],
  ] as Array<[string, string]>
).forEach(([cat, head], i) => {
  sx(
    `INSERT INTO hero_slides (id,brand_id,image_ref,category,headline,order_idx,enabled,created_at) ` +
      `VALUES ('mtl_hs_${i}','${esc(mtl)}','${esc(mtlHeroRef)}','${esc(cat)}','${esc(head)}',${i},1,${now});`,
  );
});
console.log(`  [seed] brand mtl → ${mtl} (3 hero slides)`);

// ─── portal members (budtenders; org staff sync in lazily at runtime) ─────────
const portalMembers: Array<{ id: string; brand: string; user: string | undefined }> = [
  { id: "pm_acme_bob", brand: acme, user: idByEmail.get("bob@example.com") },
  { id: "pm_beta_bob", brand: beta, user: idByEmail.get("bob@example.com") },
  { id: "pm_acme_super", brand: acme, user: idByEmail.get("super@user.com") },
  { id: "pm_mtl_bob", brand: mtl, user: idByEmail.get("bob@example.com") },
];
let seededMembers = 0;
for (const m of portalMembers) {
  if (!m.user) continue; // unresolved — skip rather than write junk
  sx(
    `INSERT OR IGNORE INTO portal_members (id, brand_id, user_id, role, source, created_at) ` +
      `VALUES ('${m.id}', '${esc(m.brand)}', '${esc(m.user)}', 'budtender', 'request', ${now});`,
  );
  seededMembers++;
}
console.log(`  [seed] portal members (budtenders): ${seededMembers} seeded`);

// ═══ 3. content ═══════════════════════════════════════════════════════════════

// ─── 3a. Acme journey content (`seed_` — the e2e/browser-journey fixture) ─────
for (const t of [
  "question_options",
  "questions",
  "certifications",
  "quizzes",
  "reviews",
  "products",
  "decks",
  "physical_requests",
  "assets",
  "comments",
  "posts",
  "chat_messages",
  "chat_rooms",
  "availability_windows",
  "group_sessions",
  "education_award",
  "user_brand_scores",
  "banner_cards",
  "ai_custom_qa",
  "ai_qa_log",
  "analytics_events",
  "notifications",
]) {
  sx(`DELETE FROM ${t} WHERE id LIKE 'seed_%';`);
}

// CanSell credential (Idea 1) is keyed on the REAL user id (platform-wide per
// person), not a `seed_` id — reset alice's row explicitly so the cansell e2e is
// reproducible: alice always starts `missing` (upload form shows).
sx(`DELETE FROM budtender_credentials WHERE user_id='${esc(alice)}';`);

// products (Drop Sheet)
sx(`INSERT INTO products (id,brand_id,category,name,thc_pct,cbd_pct,terpenes_json,effects_json,talking_points_json,format,batch,hero_image_ref,availability,available_note,deck_id,status,order_idx,created_at,updated_at) VALUES
('seed_p_garlic','${acme}','Flower','Garlic Breath',28.0,0.1,'["Myrcene 3.2%","Caryophyllene 2.1%"]','["Relaxed","Euphoric"]','["Deep garlic-diesel nose","Evening use"]','3.5g jar','Lot 248','','available',NULL,'seed_d_garlic','published',0,${NOW},${NOW}),
('seed_p_dogwalker','${acme}','Pre-Roll','Dog Walker',26.0,0.0,'["Limonene","Pinene"]','["Uplifted"]','["0.5g x 10 pack"]','0.5g x 10','PR-22','','available',NULL,NULL,'published',1,${NOW},${NOW}),
('seed_p_infused','${acme}','Infused','Infused PR',38.0,0.0,'["Terpinolene"]','["Potent"]','["Rosin-infused"]','1g cart','INF-7','','available',NULL,NULL,'published',2,${NOW},${NOW}),
('seed_p_hash','${acme}','Hash','Hash Rosin',62.0,0.0,'["Caryophyllene"]','["Solventless"]','["Connoisseur grade"]','1g','HR-3','','available',NULL,NULL,'published',3,${NOW},${NOW}),
('seed_p_drop14','${acme}','Limited','Drop #014',55.0,0.0,'["Linalool"]','["Cup-winner"]','["One-time batch"]','1g','D014','','limited','When available — limited batch',NULL,'published',4,${NOW},${NOW});`);
sx(`INSERT INTO products (id,brand_id,category,name,thc_pct,terpenes_json,effects_json,talking_points_json,format,availability,status,order_idx,created_at,updated_at) VALUES
('seed_p_beta1','${beta}','Hash','Temple Ball',60.0,'["Myrcene"]','["Traditional"]','["Hand-rolled"]','2g','available','published',0,${NOW},${NOW});`);
// Garlic Breath gets descriptor tags + provincial wholesale link so the
// Drop-Sheet e2e (rotational callout, chips, wholesale link-out) has live data.
sx(
  `UPDATE products SET tags_json='["rotational","wholesale"]', wholesale_url='https://ocs.ca/products/garlic-breath', province='ON' WHERE id='seed_p_garlic' AND brand_id='${acme}';`,
);

// reviews (distinct authors)
sx(`INSERT INTO reviews (id,brand_id,product_id,user_id,author_name,store,rating,body,created_at,updated_at) VALUES
('seed_r_bob','${acme}','seed_p_garlic','${bob}','Bob','The Green Room',5,'Customers come back for this one. The garlic nose sells itself.',${NOW},${NOW}),
('seed_r_dave','${acme}','seed_p_garlic','${dave}','Dave','High Times',4,'Strong seller for the indica crowd.',${NOW},${NOW}),
('seed_r_super','${acme}','seed_p_garlic','${sup}','Jordan','The Joint',3,'Great flower, but the price point is a hurdle.',${NOW},${NOW});`);

// decks
sx(`INSERT INTO decks (id,brand_id,title,product_line,pdf_ref,cover_thumb_ref,page_count,download_allowed,status,published_at,created_at,updated_at) VALUES
('seed_d_garlic','${acme}','Garlic Breath — Product Deck','Flower','seed-pdf-garlic',NULL,12,1,'published',${NOW},${NOW},${NOW}),
('seed_d_preroll','${acme}','Pre-Roll Lineup','Pre-Roll','seed-pdf-preroll',NULL,9,0,'published',${NOW},${NOW},${NOW});`);

// assets (one physical-available)
sx(`INSERT INTO assets (id,brand_id,name,category,type,file_ref,thumb_ref,size_bytes,physical_available,physical_max_qty,download_count,status,created_at,updated_at) VALUES
('seed_a_tent','${acme}','Tent Card','Signage','pdf','seed-file-tent',NULL,204800,1,100,0,'published',${NOW},${NOW}),
('seed_a_shelf','${acme}','Shelf Talker','Signage','pdf','seed-file-shelf',NULL,153600,1,200,0,'published',${NOW},${NOW}),
('seed_a_logo','${acme}','Logo Pack','Brand','zip','seed-file-logo',NULL,1048576,0,NULL,0,'published',${NOW},${NOW}),
('seed_a_poster','${acme}','A2 Poster','Signage','image','seed-file-poster',NULL,512000,1,50,0,'published',${NOW},${NOW});`);
sx(`INSERT INTO physical_requests (id,brand_id,asset_id,user_id,quantity,store,ship_street,ship_city,ship_province,ship_postal,contact_name,contact_phone,note,status,tracking,created_at,updated_at) VALUES
('seed_pr_1','${acme}','seed_a_tent','${bob}',25,'The Green Room','1240 Rue Sainte-Catherine','Montreal','QC','H3B 1J5','Bob','514-555-0101','For the new display by the register','Requested',NULL,${NOW},${NOW}),
('seed_pr_2','${acme}','seed_a_poster','${bob}',5,'The Green Room','1240 Rue Sainte-Catherine','Montreal','QC','H3B 1J5','Bob','514-555-0101',NULL,'Shipped','CP4821940CA',${NOW},${NOW}),
('seed_pr_alice','${acme}','seed_a_tent','${alice}',4,'The Green Room','1240 Rue Sainte-Catherine','Montreal','QC','H3B 1J5','Alice','514-555-0199',NULL,'Shipped','CPALICE0001',${NOW},${NOW});`);

// feed
sx(`INSERT INTO posts (id,brand_id,author_id,caption,product_id,like_count,comment_count,first_comment_json,brand_team,created_at) VALUES
('seed_post_1','${acme}','${alice}','Week 6 flower on our new Garlic Breath cut. Trichomes coming in heavy. #craft','seed_p_garlic',42,2,'{"authorName":"Bob","body":"Those trichomes! When does this drop?"}',1,${PAST(3600)}),
('seed_post_2','${acme}','${alice}','Harvest Day — Lot 248B is in the dry room.',NULL,18,0,NULL,1,${PAST(7200)});`);
sx(`INSERT INTO comments (id,brand_id,post_id,user_id,author_name,store,body,brand_team,heart_count,created_at) VALUES
('seed_c_1','${acme}','seed_post_1','${bob}','Bob','The Green Room','Those trichomes! When does this drop?',0,3,${PAST(1800)}),
('seed_c_2','${acme}','seed_post_1','${alice}','Acme Team',NULL,'End of month! Watch for the PK deck drop.',1,8,${PAST(900)});`);

// chat
sx(
  `INSERT INTO chat_rooms (id,brand_id,title,created_at) VALUES ('seed_room_acme','${acme}','Group Chat',${NOW});`,
);
sx(`INSERT INTO chat_messages (id,room_id,brand_id,user_id,author_name,store,body,team,created_at) VALUES
('seed_m_1','seed_room_acme','${acme}','${alice}','Acme Team',NULL,'New Garlic Breath batch approved! PK deck goes live tomorrow.',1,${PAST(2400)}),
('seed_m_2','seed_room_acme','${acme}','${bob}','Bob','The Green Room','Customers have been asking all week!',0,${PAST(1200)});`);

// booking (future window + group session)
sx(`INSERT INTO availability_windows (id,brand_id,host_id,starts_at,ends_at,slot_minutes,is_group,capacity,created_at) VALUES
('seed_w_1on1','${acme}','${alice}',${FUT(86400)},${FUT(86400 + 7200)},30,0,1,${NOW});`);
sx(`INSERT INTO group_sessions (id,brand_id,host_id,title,description,starts_at,ends_at,capacity,status,created_at) VALUES
('seed_gs_1','${acme}','${alice}','Genetics Deep Dive','Live education call on the new lineup.',${FUT(172800)},${FUT(172800 + 3600)},50,'scheduled',${NOW});`);

// education award + leaderboard scores
sx(`INSERT INTO education_award (id,brand_id,period,fund_description,covers_text,closes_at,winner_user_id,winner_name,created_at) VALUES
('seed_aw_cur','${acme}','${period}','Top learner earns a professional development fund.','Covers CannSell renewal + a course of choice.',${FUT(1728000)},NULL,NULL,${NOW}),
('seed_aw_prev','${acme}','${prevPeriod}','Top learner earns a professional development fund.','Covered my CannSell renewal + a course.',${PAST(86400)},'${bob}','Bob',${NOW});`);
sx(`INSERT INTO user_brand_scores (id,brand_id,user_id,period,score,quiz_points,deck_points,activity_points,computed_at) VALUES
('seed_s_alice','${acme}','${alice}','${period}',880,90,70,60,${NOW}),
('seed_s_bob','${acme}','${bob}','${period}',2840,96,88,70,${NOW}),
('seed_s_super','${acme}','${sup}','${period}',2390,80,75,55,${NOW}),
('seed_s_dave_beta','${beta}','${dave}','${period}',2615,92,80,60,${NOW});`);

// banners
sx(`INSERT INTO banner_cards (id,brand_id,category_tag,headline,line,link_json,dismissible,impressions,clicks,order_idx,created_at) VALUES
('seed_bn_1','${acme}','New Batch','New Batch','Garlic Breath — Lot 248 just landed','{"section":"decks"}',1,0,0,0,${NOW}),
('seed_bn_2','${acme}','Live','Live Education Call','May 22 · 2pm ET — Genetics deep dive','{"section":"feed"}',1,0,0,1,${NOW}),
('seed_bn_3','${acme}','Quiz','Know the Craft','Test your genetics + terpene knowledge','{"section":"quizzes"}',1,0,0,2,${NOW});`);

// quiz (5 question types) — matching shape: question.config.pairs
// {leftId,rightText} + option.config {right}; getting this wrong renders the
// matching dropdown labels blank (see grading.test.ts / quizzes projection).
sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('seed_q_craft','${acme}','Know the Craft','Test your strain, terpene and genetics knowledge.',60,1,NULL,NULL,'Certified Acme Budtender',1,0,'published',${NOW},${NOW},'${alice}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('seed_qq_1','seed_q_craft',0,'multiple_choice','Which terpene drives the earthy, musky aroma?',NULL,1,'Myrcene is the dominant earthy/musky terpene.','{}',${NOW},${NOW}),
('seed_qq_2','seed_q_craft',1,'true_false','Garlic Breath is best suited for evening use.',NULL,1,'Yes — relaxing indica-leaning cut.','{}',${NOW},${NOW}),
('seed_qq_3','seed_q_craft',2,'select_all','Select all effects associated with Garlic Breath.',NULL,1,'Relaxed and euphoric.','{}',${NOW},${NOW}),
('seed_qq_4','seed_q_craft',3,'image','Identify the trichome stage shown.',NULL,1,'Cloudy trichomes indicate peak THC.','{}',${NOW},${NOW}),
('seed_qq_5','seed_q_craft',4,'matching','Match the terpene to its effect.',NULL,1,'Myrcene→relaxation, Limonene→uplift.','{"pairs":[{"leftId":"seed_o_5a","rightText":"Relaxation"},{"leftId":"seed_o_5b","rightText":"Uplift"}]}',${NOW},${NOW});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('seed_o_1a','seed_qq_1',0,'Myrcene',NULL,1,1,'{}'),
('seed_o_1b','seed_qq_1',1,'Limonene',NULL,0,1,'{}'),
('seed_o_1c','seed_qq_1',2,'Linalool',NULL,0,1,'{}'),
('seed_o_1d','seed_qq_1',3,'Pinene',NULL,0,1,'{}'),
('seed_o_2a','seed_qq_2',0,'True',NULL,1,1,'{}'),
('seed_o_2b','seed_qq_2',1,'False',NULL,0,1,'{}'),
('seed_o_3a','seed_qq_3',0,'Relaxed',NULL,1,1,'{}'),
('seed_o_3b','seed_qq_3',1,'Euphoric',NULL,1,1,'{}'),
('seed_o_3c','seed_qq_3',2,'Anxious',NULL,0,1,'{}'),
('seed_o_4a','seed_qq_4',0,'Cloudy (peak THC)',NULL,1,1,'{}'),
('seed_o_4b','seed_qq_4',1,'Clear (immature)',NULL,0,1,'{}'),
('seed_o_5a','seed_qq_5',0,'Myrcene',NULL,1,1,'{"right":"Relaxation"}'),
('seed_o_5b','seed_qq_5',1,'Limonene',NULL,1,1,'{"right":"Uplift"}');`);

// AI log + analytics + notifications
sx(`INSERT INTO ai_custom_qa (id,brand_id,question,answer,enabled,created_by,created_at,updated_at) VALUES
('seed_qa_1','${acme}','What do I tell a customer who wants something for sleep?','Point them to Garlic Breath — 28% THC indica hybrid, myrcene-dominant.',1,'${alice}',${NOW},${NOW});`);
sx(`INSERT INTO ai_qa_log (id,brand_id,user_id,question,answer,source,source_id,kind,created_at) VALUES
('seed_ql_1','${acme}','${bob}','Something for sleep?','For sleep, point them to Garlic Breath.','product','seed_p_garlic','customer',${PAST(5000)}),
('seed_ql_2','${acme}','${bob}','Highest THC in stock?','Hash Rosin at 62% THC.','product','seed_p_hash','customer',${PAST(4000)});`);
sx(`INSERT INTO analytics_events (id,brand_id,actor_id,type,target_type,target_id,metadata_json,created_at) VALUES
('seed_ev_1','${acme}','${bob}','deck_open','deck','seed_d_garlic','{"page":11}',${PAST(6000)}),
('seed_ev_2','${acme}','${bob}','product_view','product','seed_p_garlic','{}',${PAST(5500)}),
('seed_ev_3','${acme}','${bob}','asset_download','asset','seed_a_logo','{}',${PAST(5200)});`);
sx(`INSERT INTO notifications (id,brand_id,user_id,type,title,body,ref_type,ref_id,read_at,created_at) VALUES
('seed_n_1','${acme}','${alice}','new_post','New post in Enter the Grow','Week 6 flower on our new Garlic Breath cut.','post','seed_post_1',NULL,${PAST(1000)}),
('seed_n_2','${acme}','${alice}','new_quiz','New quiz: Know the Craft','Test your genetics + terpene knowledge.','quiz','seed_q_craft',NULL,${PAST(2000)});`);

console.log(
  `  [seed] acme(${acme}) journey content — products, reviews, decks, assets, feed, chat, booking, quiz, scores, award`,
);

// ─── 3b. RICH demo content, both brands (`demo_` — walkthrough polish) ────────
for (const t of [
  "question_options",
  "questions",
  "quizzes",
  "reviews",
  "products",
  "decks",
  "assets",
  "comments",
  "posts",
  "chat_messages",
  "chat_rooms",
  "group_sessions",
  "availability_windows",
  "education_award",
  "user_brand_scores",
  "banner_cards",
]) {
  sx(`DELETE FROM ${t} WHERE id LIKE 'demo_%';`);
}

// ═ ACME ═ more strains, some linked to new decks.
sx(`INSERT INTO products (id,brand_id,category,name,thc_pct,cbd_pct,terpenes_json,effects_json,talking_points_json,format,batch,hero_image_ref,availability,available_note,deck_id,status,order_idx,created_at,updated_at) VALUES
('demo_p_pinkkush','${acme}','Flower','Pink Kush',24.5,0.2,'["Myrcene 2.8%","Caryophyllene 1.4%","Limonene 0.9%"]','["Relaxed","Sleepy","Euphoric"]','["Classic BC indica, sweet floral nose","Best for the after-work crowd","Pairs with the Garlic Breath fans"]','3.5g jar','Lot 251','','available',NULL,'demo_d_terpenes','published',10,${NOW},${NOW}),
('demo_p_mac1','${acme}','Flower','MAC 1',26.2,0.1,'["Limonene 2.2%","Pinene 1.1%","Caryophyllene 1.0%"]','["Balanced","Creative","Talkative"]','["Miracle Alien Cookies — gassy + citrus","Great daytime hybrid recommendation","Frosty bag appeal sells itself"]','3.5g jar','Lot 252','','available',NULL,NULL,'published',11,${NOW},${NOW}),
('demo_p_wcake','${acme}','Flower','Wedding Cake',25.0,0.1,'["Caryophyllene 2.0%","Limonene 1.6%"]','["Relaxed","Happy","Hungry"]','["Tangy vanilla, dense buds","A reliable top-shelf upsell"]','3.5g jar','Lot 253','','available',NULL,NULL,'published',12,${NOW},${NOW}),
('demo_p_bluedream','${acme}','Flower','Blue Dream',22.0,0.3,'["Myrcene 2.4%","Pinene 1.3%"]','["Uplifted","Focused","Creative"]','["The all-day sativa-leaning staple","Berry nose, gentle onset","Good first-timer recommendation"]','3.5g jar','Lot 254','','available',NULL,NULL,'published',13,${NOW},${NOW}),
('demo_p_rso','${acme}','Extract','Full-Spectrum RSO',62.0,2.0,'["Myrcene","Linalool"]','["Potent","Sedative"]','["1mL oral applicator","For the experienced / wellness customer","Start low, go slow messaging"]','1mL','RSO-9','','available',NULL,NULL,'published',14,${NOW},${NOW}),
('demo_p_gummies','${acme}','Edible','Live Rosin Gummies',0.0,0.0,'["Solventless"]','["Relaxed","Tasty"]','["10mg THC x 10 — solventless","Raspberry, real-rosin infused","Great non-inhalation option"]','10mg x10','GUM-4','','limited','Back in stock Friday',NULL,'published',15,${NOW},${NOW});`);

sx(`INSERT INTO decks (id,brand_id,title,product_line,pdf_ref,cover_thumb_ref,page_count,download_allowed,status,published_at,created_at,updated_at) VALUES
('demo_d_terpenes','${acme}','Terpene Science — The Entourage Effect','Education','demo-pdf-terpenes',NULL,18,1,'published',${NOW},${NOW},${NOW}),
('demo_d_indica','${acme}','The Indica / Sativa Myth — What Actually Matters','Education','demo-pdf-indica',NULL,14,1,'published',${NOW},${NOW},${NOW}),
('demo_d_rosin','${acme}','Live Rosin — From Wash to Jar','Concentrates','demo-pdf-rosin',NULL,22,0,'published',${NOW},${NOW},${NOW});`);

sx(`INSERT INTO reviews (id,brand_id,product_id,user_id,author_name,store,rating,body,created_at,updated_at) VALUES
('demo_r_pk_bob','${acme}','demo_p_pinkkush','${bob}','Bob','The Green Room',5,'My sleep-trouble regulars love Pink Kush. Repeat buys every week.',${PAST(40000)},${PAST(40000)}),
('demo_r_mac_alice','${acme}','demo_p_mac1','${alice}','Acme Team',NULL,5,'MAC 1 bag appeal is unreal — it upsells itself on the shelf.',${PAST(30000)},${PAST(30000)}),
('demo_r_bd_admin','${acme}','demo_p_bluedream','${admin}','Jordan','Beacon Cannabis',4,'Blue Dream is my go-to for nervous first-timers. Gentle and familiar.',${PAST(20000)},${PAST(20000)}),
('demo_r_wc_bob','${acme}','demo_p_wcake','${bob}','Bob','The Green Room',5,'Wedding Cake moves fast on weekends. Dessert-strain crowd loves it.',${PAST(10000)},${PAST(10000)});`);

sx(`INSERT INTO posts (id,brand_id,author_id,caption,product_id,like_count,comment_count,first_comment_json,brand_team,created_at) VALUES
('demo_post_mac','${acme}','${alice}','MAC 1 just hit the shelves 🔬 Gassy citrus, frosty as ever. Tag a regular who needs to know.','demo_p_mac1',57,1,'{"authorName":"Bob","body":"Already sold three jars this morning!"}',1,${PAST(5400)}),
('demo_post_terp','${acme}','${admin}','New PK deck is live: Terpene Science. 18 pages on why myrcene ≠ sleepy every time. Required reading before the next drop call. 📚',NULL,33,1,'{"authorName":"Alice","body":"The entourage-effect section is gold."}',1,${PAST(9000)});`);
sx(`INSERT INTO comments (id,brand_id,post_id,user_id,author_name,store,body,brand_team,heart_count,created_at) VALUES
('demo_c_mac_1','${acme}','demo_post_mac','${bob}','Bob','The Green Room','Already sold three jars this morning!',0,6,${PAST(5000)}),
('demo_c_mac_2','${acme}','demo_post_mac','${admin}','Jordan','Beacon Cannabis','What''s the batch THC on this run?',0,1,${PAST(4800)}),
('demo_c_terp_1','${acme}','demo_post_terp','${alice}','Acme Team',NULL,'The entourage-effect section is gold.',1,9,${PAST(8700)});`);

sx(`INSERT INTO banner_cards (id,brand_id,category_tag,headline,line,link_json,dismissible,impressions,clicks,order_idx,created_at) VALUES
('demo_bn_mac','${acme}','New Drop','MAC 1 has landed','Frosty gas-citrus hybrid — Lot 252 on shelves now','{"section":"decks"}',1,140,22,10,${NOW}),
('demo_bn_terp','${acme}','Education','New PK Deck','Terpene Science: the entourage effect, 18 pages','{"section":"decks"}',1,98,15,11,${NOW}),
('demo_bn_quiz2','${acme}','Quiz','Earn your Terpene badge','5 questions — climb the leaderboard','{"section":"quizzes"}',1,77,30,12,${NOW});`);

sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('demo_q_terp','${acme}','Terpene Deep Dive','Prove you understand the aromas behind the effects.',70,1,NULL,NULL,'Acme Terpene Specialist',1,0,'published',${NOW},${NOW},'${alice}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('demo_qt_1','demo_q_terp',0,'multiple_choice','Which terpene is most associated with a peppery, spicy aroma and binds CB2 receptors?',NULL,1,'Caryophyllene is the peppery terpene and the only one that acts on CB2.','{}',${NOW},${NOW}),
('demo_qt_2','demo_q_terp',1,'true_false','High myrcene ALWAYS guarantees a sedative ''couch-lock'' effect.',NULL,1,'False — the entourage effect depends on the whole profile, not one terpene.','{}',${NOW},${NOW}),
('demo_qt_3','demo_q_terp',2,'select_all','Select every terpene commonly described as citrus-forward.',NULL,1,'Limonene and (to a lesser extent) terpinolene read citrus; pinene is pine.','{}',${NOW},${NOW}),
('demo_qt_4','demo_q_terp',3,'matching','Match the terpene to its signature aroma.',NULL,1,'Limonene→citrus, Pinene→pine, Linalool→floral.','{"pairs":[{"leftId":"demo_ot_4a","rightText":"Citrus"},{"leftId":"demo_ot_4b","rightText":"Pine"},{"leftId":"demo_ot_4c","rightText":"Floral / lavender"}]}',${NOW},${NOW});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('demo_ot_1a','demo_qt_1',0,'Caryophyllene',NULL,1,1,'{}'),
('demo_ot_1b','demo_qt_1',1,'Myrcene',NULL,0,1,'{}'),
('demo_ot_1c','demo_qt_1',2,'Limonene',NULL,0,1,'{}'),
('demo_ot_1d','demo_qt_1',3,'Pinene',NULL,0,1,'{}'),
('demo_ot_2a','demo_qt_2',0,'True',NULL,0,1,'{}'),
('demo_ot_2b','demo_qt_2',1,'False',NULL,1,1,'{}'),
('demo_ot_3a','demo_qt_3',0,'Limonene',NULL,1,1,'{}'),
('demo_ot_3b','demo_qt_3',1,'Terpinolene',NULL,1,1,'{}'),
('demo_ot_3c','demo_qt_3',2,'Pinene',NULL,0,1,'{}'),
('demo_ot_4a','demo_qt_4',0,'Limonene',NULL,1,1,'{"right":"Citrus"}'),
('demo_ot_4b','demo_qt_4',1,'Pinene',NULL,1,1,'{"right":"Pine"}'),
('demo_ot_4c','demo_qt_4',2,'Linalool',NULL,1,1,'{"right":"Floral / lavender"}');`);

sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('demo_q_sell','${acme}','Responsible Selling Refresher','A quick check on legal limits and duty-to-refuse basics.',80,1,NULL,NULL,'Responsible Seller — Refreshed',1,0,'published',${NOW},${NOW},'${admin}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('demo_qs_1','demo_q_sell',0,'multiple_choice','What is the single-transaction possession limit (dried-equivalent) for an adult customer?',NULL,1,'30 grams of dried cannabis (or equivalent) per transaction.','{}',${NOW},${NOW}),
('demo_qs_2','demo_q_sell',1,'true_false','You must refuse a sale to a customer who appears intoxicated, even with valid ID.',NULL,1,'True — duty to refuse applies regardless of ID.','{}',${NOW},${NOW}),
('demo_qs_3','demo_q_sell',2,'select_all','Which are valid pieces of government photo ID for an age check?',NULL,1,'Driver''s licence and passport are valid; a student card is not.','{}',${NOW},${NOW});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('demo_os_1a','demo_qs_1',0,'30 grams',NULL,1,1,'{}'),
('demo_os_1b','demo_qs_1',1,'15 grams',NULL,0,1,'{}'),
('demo_os_1c','demo_qs_1',2,'50 grams',NULL,0,1,'{}'),
('demo_os_1d','demo_qs_1',3,'No limit',NULL,0,1,'{}'),
('demo_os_2a','demo_qs_2',0,'True',NULL,1,1,'{}'),
('demo_os_2b','demo_qs_2',1,'False',NULL,0,1,'{}'),
('demo_os_3a','demo_qs_3',0,'Driver''s licence',NULL,1,1,'{}'),
('demo_os_3b','demo_qs_3',1,'Passport',NULL,1,1,'{}'),
('demo_os_3c','demo_qs_3',2,'Student card',NULL,0,1,'{}');`);

sx(`INSERT INTO user_brand_scores (id,brand_id,user_id,period,score,quiz_points,deck_points,activity_points,computed_at) VALUES
('demo_s_admin','${acme}','${admin}','${period}',3120,98,92,80,${NOW});`);

// ═ BETA ═ a COMPLETE craft-hash portal so the second skin is real.
sx(`INSERT INTO products (id,brand_id,category,name,thc_pct,cbd_pct,terpenes_json,effects_json,talking_points_json,format,batch,hero_image_ref,availability,available_note,deck_id,status,order_idx,created_at,updated_at) VALUES
('demo_pb_static','${beta}','Hash','Static Sift — 120u',58.0,0.0,'["Myrcene","Caryophyllene"]','["Smooth","Full-melt"]','["Dry-sift, 120 micron","Full-melt connoisseur grade","Hand-pressed in small runs"]','2g','SS-12','','available',NULL,'demo_db_hash101','published',10,${NOW},${NOW}),
('demo_pb_badder','${beta}','Concentrate','Live Rosin Badder',72.0,0.0,'["Limonene","Linalool"]','["Flavourful","Potent"]','["Single-source live rosin","Whipped to a badder consistency","Cold-cured 72h"]','1g','LRB-5','','available',NULL,'demo_db_solventless','published',11,${NOW},${NOW}),
('demo_pb_bubble','${beta}','Hash','Bubble Hash — 6 Star',55.0,0.0,'["Myrcene"]','["Classic","Hand-washed"]','["Ice-water wash, 6-star","73–90 micron blend","Old-school flavour"]','2g','BH-6','','available',NULL,NULL,'published',12,${NOW},${NOW}),
('demo_pb_charas','${beta}','Hash','Himalayan Charas',48.0,0.0,'["Terpinolene"]','["Traditional","Hand-rubbed"]','["Hand-rubbed temple style","Limited seasonal run","Pliable, aromatic"]','2g','HC-2','','limited','Seasonal — limited run',NULL,'published',13,${NOW},${NOW}),
('demo_pb_rosincart','${beta}','Concentrate','Rosin Vape — 510',70.0,0.0,'["Caryophyllene"]','["Solventless","Convenient"]','["Solventless rosin, no additives","510-thread, ceramic coil","Strain-specific batches"]','0.5g','RV-3','','available',NULL,NULL,'published',14,${NOW},${NOW});`);

sx(`INSERT INTO decks (id,brand_id,title,product_line,pdf_ref,cover_thumb_ref,page_count,download_allowed,status,published_at,created_at,updated_at) VALUES
('demo_db_hash101','${beta}','Hash Making 101 — Sift, Wash & Press','Education','demo-pdf-hash101',NULL,16,1,'published',${NOW},${NOW},${NOW}),
('demo_db_solventless','${beta}','Solventless vs Solvent — What to Tell Customers','Education','demo-pdf-solventless',NULL,12,1,'published',${NOW},${NOW},${NOW});`);

sx(`INSERT INTO reviews (id,brand_id,product_id,user_id,author_name,store,rating,body,created_at,updated_at) VALUES
('demo_rb_static_dave','${beta}','demo_pb_static','${dave}','Beta Team',NULL,5,'Our 120u static sift is the cleanest full-melt we''ve run. Connoisseurs ask for it by name.',${PAST(35000)},${PAST(35000)}),
('demo_rb_badder_bob','${beta}','demo_pb_badder','${bob}','Bob','The Green Room',5,'The live rosin badder flavour is unreal. Easy premium upsell.',${PAST(22000)},${PAST(22000)}),
('demo_rb_bubble_admin','${beta}','demo_pb_bubble','${admin}','Jordan','Beacon Cannabis',4,'Classic 6-star bubble — the old-heads love it. Moves steady.',${PAST(12000)},${PAST(12000)});`);

sx(`INSERT INTO posts (id,brand_id,author_id,caption,product_id,like_count,comment_count,first_comment_json,brand_team,created_at) VALUES
('demo_postb_wash','${beta}','${dave}','Wash day 🧊 Fresh-frozen down the line for this week''s Live Rosin run. The trichome heads on this batch are massive.','demo_pb_badder',61,1,'{"authorName":"Bob","body":"That return is going to be insane."}',1,${PAST(6000)}),
('demo_postb_charas','${beta}','${dave}','Seasonal Himalayan Charas is back for a limited run. Hand-rubbed, temple style. Don''t sleep on it.','demo_pb_charas',44,0,NULL,1,${PAST(12000)});`);
sx(`INSERT INTO comments (id,brand_id,post_id,user_id,author_name,store,body,brand_team,heart_count,created_at) VALUES
('demo_cb_wash_1','${beta}','demo_postb_wash','${bob}','Bob','The Green Room','That return is going to be insane.',0,7,${PAST(5600)});`);

sx(
  `INSERT INTO chat_rooms (id,brand_id,title,created_at) VALUES ('demo_room_beta','${beta}','Group Chat',${NOW});`,
);
sx(`INSERT INTO chat_messages (id,room_id,brand_id,user_id,author_name,store,body,team,created_at) VALUES
('demo_mb_1','demo_room_beta','${beta}','${dave}','Beta Team',NULL,'Live Rosin badder drops Friday — PK deck is live now, give it a read before your shift.',1,${PAST(3000)}),
('demo_mb_2','demo_room_beta','${beta}','${bob}','Bob','The Green Room','On it. The solventless deck is a great customer explainer too.',0,${PAST(1500)});`);

sx(`INSERT INTO banner_cards (id,brand_id,category_tag,headline,line,link_json,dismissible,impressions,clicks,order_idx,created_at) VALUES
('demo_bnb_rosin','${beta}','New Drop','Live Rosin Badder','Single-source, cold-cured 72h — drops Friday','{"section":"decks"}',1,120,40,10,${NOW}),
('demo_bnb_charas','${beta}','Limited','Himalayan Charas is back','Hand-rubbed seasonal run — while it lasts','{"section":"decks"}',1,86,19,11,${NOW}),
('demo_bnb_quiz','${beta}','Quiz','Hash Connoisseur badge','6 questions on sift, wash & press','{"section":"quizzes"}',1,54,21,12,${NOW});`);

sx(`INSERT INTO group_sessions (id,brand_id,host_id,title,description,starts_at,ends_at,capacity,status,created_at) VALUES
('demo_gsb_1','${beta}','${dave}','Solventless Masterclass','Live walkthrough: wash, press, and how to sell the difference.',${FUT(259200)},${FUT(259200 + 3600)},40,'scheduled',${NOW});`);
sx(`INSERT INTO availability_windows (id,brand_id,host_id,starts_at,ends_at,slot_minutes,is_group,capacity,created_at) VALUES
('demo_wb_1','${beta}','${dave}',${FUT(172800)},${FUT(172800 + 7200)},30,0,1,${NOW});`);

sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('demo_qb_hash','${beta}','Hash Connoisseur','Sift, wash, press — know your craft hash cold.',70,1,NULL,NULL,'Beta Hash Connoisseur',1,0,'published',${NOW},${NOW},'${dave}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('demo_qbh_1','demo_qb_hash',0,'multiple_choice','What does the ''6-star'' grade describe in bubble hash?',NULL,1,'Star rating reflects purity/meltiness — 6-star is full-melt.','{}',${NOW},${NOW}),
('demo_qbh_2','demo_qb_hash',1,'true_false','Live rosin is a SOLVENTLESS concentrate.',NULL,1,'True — it''s pressed from washed, fresh-frozen material with heat + pressure, no solvent.','{}',${NOW},${NOW}),
('demo_qbh_3','demo_qb_hash',2,'select_all','Which are solventless processes?',NULL,1,'Dry sift and ice-water (bubble) wash are solventless; BHO uses butane.','{}',${NOW},${NOW}),
('demo_qbh_4','demo_qb_hash',3,'matching','Match the micron range to the screen it passes.',NULL,1,'Heads concentrate in the 73–120 micron range.','{"pairs":[{"leftId":"demo_obh_4a","rightText":"Full-melt heads"},{"leftId":"demo_obh_4b","rightText":"Contamination / plant matter"}]}',${NOW},${NOW});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('demo_obh_1a','demo_qbh_1',0,'Full-melt purity grade',NULL,1,1,'{}'),
('demo_obh_1b','demo_qbh_1',1,'THC percentage',NULL,0,1,'{}'),
('demo_obh_1c','demo_qbh_1',2,'Number of washes',NULL,0,1,'{}'),
('demo_obh_2a','demo_qbh_2',0,'True',NULL,1,1,'{}'),
('demo_obh_2b','demo_qbh_2',1,'False',NULL,0,1,'{}'),
('demo_obh_3a','demo_qbh_3',0,'Dry sift',NULL,1,1,'{}'),
('demo_obh_3b','demo_qbh_3',1,'Ice-water wash',NULL,1,1,'{}'),
('demo_obh_3c','demo_qbh_3',2,'Butane extraction',NULL,0,1,'{}'),
('demo_obh_4a','demo_qbh_4',0,'73–120 micron',NULL,1,1,'{"right":"Full-melt heads"}'),
('demo_obh_4b','demo_qbh_4',1,'Below 45 micron',NULL,1,1,'{"right":"Contamination / plant matter"}');`);

// Beta education award. (dave's Beta leaderboard score comes from the journey
// content above; bob is a Beta budtender — portal member — with no score row.)
sx(`INSERT INTO education_award (id,brand_id,period,fund_description,covers_text,closes_at,winner_user_id,winner_name,created_at) VALUES
('demo_awb_cur','${beta}','${period}','Top learner earns a hash-making workshop seat.','Covers a hands-on solventless workshop + travel.',${FUT(1900000)},NULL,NULL,${NOW});`);

console.log(
  `  [seed] acme(${acme}) + beta(${beta}) enriched — strains, decks, quizzes, feed, reviews, banners, booking, scores`,
);

// ─── 3c. MTL content (`mtl_` — the dark third portal) ─────────────────────────
for (const t of [
  "question_options",
  "questions",
  "quizzes",
  "reviews",
  "products",
  "decks",
  "comments",
  "posts",
  "chat_messages",
  "chat_rooms",
  "banner_cards",
  "user_brand_scores",
  "education_award",
]) {
  sx(`DELETE FROM ${t} WHERE id LIKE 'mtl_%';`);
}

sx(`INSERT INTO products (id,brand_id,category,name,thc_pct,cbd_pct,terpenes_json,effects_json,talking_points_json,format,batch,hero_image_ref,availability,available_note,deck_id,status,order_idx,created_at,updated_at) VALUES
('mtl_p_papaya','${mtl}','Flower','Papaya Wine',27.5,0.1,'["Myrcene 2.6%","Caryophyllene 1.5%","Limonene 0.8%"]','["Relaxed","Euphoric","Sleepy"]','["Craft indica — gassy-sweet tropical nose","Montreal-grown, hang-dried, hand-trimmed","The after-work heavy-hitter"]','3.5g jar','Lot 248','','available',NULL,'mtl_d_lineup','published',0,${now},${now}),
('mtl_p_garlic','${mtl}','Flower','Garlic Sauce',26.0,0.1,'["Caryophyllene 2.1%","Limonene 1.3%"]','["Balanced","Focused","Talkative"]','["Funky gas-and-garlic hybrid","Dense, frosty bag appeal","Great daytime-into-evening rec"]','3.5g jar','Lot 249','','available',NULL,NULL,'published',1,${now},${now}),
('mtl_p_sunset','${mtl}','Flower','Sunset Runtz',25.0,0.2,'["Limonene 1.9%","Linalool 1.1%"]','["Happy","Creative","Relaxed"]','["Candy-sweet hybrid, smooth finish","Approachable for newer customers","Sunset-fruit terp profile"]','3.5g jar','Lot 250','','available',NULL,NULL,'published',2,${now},${now}),
('mtl_p_legacy','${mtl}','Flower','Legacy Kush',24.0,0.3,'["Myrcene 2.9%","Pinene 1.0%"]','["Relaxed","Calm","Sleepy"]','["Old-school legacy-market genetics","Earthy hash-forward nose","For the connoisseur regulars"]','3.5g jar','Lot 251','','available',NULL,NULL,'published',3,${now},${now}),
('mtl_p_bubble','${mtl}','Hash','6★ Bubble Hash',56.0,0.0,'["Myrcene","Caryophyllene"]','["Full-melt","Smooth"]','["Ice-water wash, 6-star full-melt","73–120 micron heads","Small-batch, hand-pressed"]','2g','BH-6','','available',NULL,'mtl_d_lineup','published',4,${now},${now}),
('mtl_p_sift','${mtl}','Hash','Static Sift — 90u',60.0,0.0,'["Terpinolene","Limonene"]','["Connoisseur","Aromatic"]','["Dry-sift, 90 micron","Melts clean, keeps the terps","Sprinkle a bowl or press it"]','2g','SS-9','','limited','Small run — while it lasts',NULL,'published',5,${now},${now}),
('mtl_p_preroll','${mtl}','Pre-Roll','Papaya Wine Craft Pre-Roll',27.0,0.1,'["Myrcene","Caryophyllene"]','["Relaxed","Euphoric"]','["Whole-flower, hand-rolled","Same Lot 248 Papaya Wine","3 x 0.5g pack"]','3 x 0.5g','PR-248','','available',NULL,NULL,'published',6,${now},${now}),
('mtl_p_sugarcane','${mtl}','Limited','Sugar Cane — Legacy Drop',28.0,0.1,'["Caryophyllene","Limonene","Myrcene"]','["Potent","Euphoric"]','["One-time legacy-genetics batch","Loud sweet-gas nose","Collector shelf — moves fast"]','3.5g jar','LD-01','','limited','One-time batch',NULL,'published',7,${now},${now});`);

sx(`INSERT INTO decks (id,brand_id,title,product_line,pdf_ref,cover_thumb_ref,page_count,download_allowed,status,published_at,created_at,updated_at) VALUES
('mtl_d_lineup','${mtl}','MTL Current Lineup — PK Deck','Product Knowledge','mtl-pdf-lineup',NULL,20,1,'published',${now},${now},${now}),
('mtl_d_terps','${mtl}','Terpene Reference Guide','Education','mtl-pdf-terps',NULL,12,1,'published',${now},${now},${now}),
('mtl_d_sell','${mtl}','How to Sell MTL — Selling Guide','Education','mtl-pdf-sell',NULL,15,1,'published',${now},${now},${now});`);

if (idByEmail.get("bob@example.com")) {
  sx(`INSERT INTO reviews (id,brand_id,product_id,user_id,author_name,store,rating,body,created_at,updated_at) VALUES
('mtl_r_papaya_bob','${mtl}','mtl_p_papaya','${bob}','Bob','The Green Room',5,'Papaya Wine is my #1 indica rec now. Regulars come back for it by name.',${now - 40000000},${now - 40000000}),
('mtl_r_bubble_bob','${mtl}','mtl_p_bubble','${bob}','Bob','The Green Room',5,'The 6-star bubble melts clean off the dab tool. Connoisseurs love it.',${now - 20000000},${now - 20000000});`);
}
sx(`INSERT INTO reviews (id,brand_id,product_id,user_id,author_name,store,rating,body,created_at,updated_at) VALUES
('mtl_r_garlic_admin','${mtl}','mtl_p_garlic','${mtlAdmin}','MTL Team',NULL,5,'Garlic Sauce bag appeal sells itself — funky gas, frosty, dense.',${now - 30000000},${now - 30000000});`);

sx(`INSERT INTO posts (id,brand_id,author_id,caption,product_id,like_count,comment_count,first_comment_json,brand_team,created_at) VALUES
('mtl_post_papaya','${mtl}','${mtlAdmin}','Papaya Wine just hit the shelves 🌿 Craft indica, gassy-sweet nose — Lot 248, Montreal-grown, hang-dried. Tag a regular who needs it.','mtl_p_papaya',72,1,'{"authorName":"Bob","body":"Sold four jars before noon."}',1,${now - 5400000}),
('mtl_post_grow','${mtl}','${mtlAdmin}','Week 6 in the flower room 📸 canopy is frosting up nicely — harvest day soon. Every batch builds legacy.',NULL,58,0,NULL,1,${now - 10800000});`);
if (idByEmail.get("bob@example.com")) {
  sx(`INSERT INTO comments (id,brand_id,post_id,user_id,author_name,store,body,brand_team,heart_count,created_at) VALUES
('mtl_c_papaya_1','${mtl}','mtl_post_papaya','${bob}','Bob','The Green Room','Sold four jars before noon.',0,8,${now - 5000000});`);
}

sx(
  `INSERT INTO chat_rooms (id,brand_id,title,created_at) VALUES ('mtl_room','${mtl}','Group Chat',${now});`,
);
sx(
  `INSERT INTO chat_messages (id,room_id,brand_id,user_id,author_name,store,body,team,created_at) VALUES ` +
    `('mtl_m_1','mtl_room','${mtl}','${mtlAdmin}','MTL Team',NULL,'Papaya Wine + the Legacy Drop are live — read the new PK deck before your shift 🙏',1,${now - 3000000})` +
    (idByEmail.get("bob@example.com")
      ? `,('mtl_m_2','mtl_room','${mtl}','${bob}','Bob','The Green Room','On it — the terpene guide is a great customer explainer too.',0,${now - 1500000})`
      : "") +
    `;`,
);

sx(`INSERT INTO banner_cards (id,brand_id,category_tag,headline,line,link_json,dismissible,impressions,clicks,order_idx,created_at) VALUES
('mtl_bn_batch','${mtl}','New Batch','Papaya Wine has landed','Craft indica, gassy-sweet — Lot 248 on shelves now','{"section":"drops"}',1,140,26,0,${now}),
('mtl_bn_deck','${mtl}','Education','New PK Deck','Terpene Reference Guide is live — read before the drop','{"section":"decks"}',1,96,14,1,${now}),
('mtl_bn_quiz','${mtl}','Quiz','Know the Craft','Earn your MTL Brand Certified badge','{"section":"quizzes"}',1,80,33,2,${now});`);

sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('mtl_q_brand','${mtl}','MTL Brand Foundations','Brand story, values, and messaging — the essentials every MTL rep should know.',80,1,NULL,NULL,'MTL Brand Certified',1,0,'published',${now},${now},'${mtlAdmin}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('mtl_qb_1','mtl_q_brand',0,'multiple_choice','Where is MTL Cannabis cultivated?',NULL,1,'MTL is Montreal-born and Montreal-cultivated.','{}',${now},${now}),
('mtl_qb_2','mtl_q_brand',1,'true_false','MTL positions itself as craft-grade cannabis at a fair price.',NULL,1,'True — "quality you expect at a fair price."','{}',${now},${now}),
('mtl_qb_3','mtl_q_brand',2,'select_all','Which are MTL core values?',NULL,1,'Community, Excellence, and Genetics.','{}',${now},${now}),
('mtl_qb_4','mtl_q_brand',3,'multiple_choice','MTL traces its roots to which year?',NULL,1,'Rooted in the legacy market since 2016.','{}',${now},${now});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('mtl_ob_1a','mtl_qb_1',0,'Montreal',NULL,1,1,'{}'),('mtl_ob_1b','mtl_qb_1',1,'Toronto',NULL,0,1,'{}'),('mtl_ob_1c','mtl_qb_1',2,'Vancouver',NULL,0,1,'{}'),
('mtl_ob_2a','mtl_qb_2',0,'True',NULL,1,1,'{}'),('mtl_ob_2b','mtl_qb_2',1,'False',NULL,0,1,'{}'),
('mtl_ob_3a','mtl_qb_3',0,'Community',NULL,1,1,'{}'),('mtl_ob_3b','mtl_qb_3',1,'Excellence',NULL,1,1,'{}'),('mtl_ob_3c','mtl_qb_3',2,'Genetics',NULL,1,1,'{}'),('mtl_ob_3d','mtl_qb_3',3,'Franchising',NULL,0,1,'{}'),
('mtl_ob_4a','mtl_qb_4',0,'2016',NULL,1,1,'{}'),('mtl_ob_4b','mtl_qb_4',1,'2020',NULL,0,1,'{}'),('mtl_ob_4c','mtl_qb_4',2,'2010',NULL,0,1,'{}');`);

sx(`INSERT INTO quizzes (id,brand_id,title,description,pass_threshold,retakes_allowed,max_attempts,time_limit_seconds,cert_name,on_leaderboard,shuffle_questions,status,created_at,updated_at,created_by) VALUES
('mtl_q_strain','${mtl}','Strain Knowledge — Current Lineup','Terpene profiles, effects, and how to guide customers through the MTL lineup.',70,1,NULL,NULL,'MTL Strain Specialist',1,0,'published',${now},${now},'${mtlAdmin}');`);
sx(`INSERT INTO questions (id,quiz_id,order_idx,type,prompt,image_ref,points,explanation,config_json,created_at,updated_at) VALUES
('mtl_qs_1','mtl_q_strain',0,'multiple_choice','Which MTL strain is the gassy-sweet craft INDICA?',NULL,1,'Papaya Wine — the after-work heavy-hitter.','{}',${now},${now}),
('mtl_qs_2','mtl_q_strain',1,'true_false','6★ Bubble Hash is a solventless, ice-water-washed concentrate.',NULL,1,'True — ice-water wash, no solvent.','{}',${now},${now}),
('mtl_qs_3','mtl_q_strain',2,'matching','Match the terpene to its aroma.',NULL,1,'Limonene→citrus, Myrcene→earthy, Caryophyllene→pepper.','{"pairs":[{"leftId":"mtl_os_3a","rightText":"Citrus"},{"leftId":"mtl_os_3b","rightText":"Earthy / musky"},{"leftId":"mtl_os_3c","rightText":"Pepper / gas"}]}',${now},${now});`);
sx(`INSERT INTO question_options (id,question_id,order_idx,text,image_ref,is_correct,weight,config_json) VALUES
('mtl_os_1a','mtl_qs_1',0,'Papaya Wine',NULL,1,1,'{}'),('mtl_os_1b','mtl_qs_1',1,'Sunset Runtz',NULL,0,1,'{}'),('mtl_os_1c','mtl_qs_1',2,'Garlic Sauce',NULL,0,1,'{}'),
('mtl_os_2a','mtl_qs_2',0,'True',NULL,1,1,'{}'),('mtl_os_2b','mtl_qs_2',1,'False',NULL,0,1,'{}'),
('mtl_os_3a','mtl_qs_3',0,'Limonene',NULL,1,1,'{"right":"Citrus"}'),('mtl_os_3b','mtl_qs_3',1,'Myrcene',NULL,1,1,'{"right":"Earthy / musky"}'),('mtl_os_3c','mtl_qs_3',2,'Caryophyllene',NULL,1,1,'{"right":"Pepper / gas"}');`);

sx(`INSERT INTO user_brand_scores (id,brand_id,user_id,period,score,quiz_points,deck_points,activity_points,computed_at) VALUES
('mtl_s_admin','${mtl}','${mtlAdmin}','${period}',2980,96,90,74,${now});`);
sx(`INSERT INTO education_award (id,brand_id,period,fund_description,covers_text,closes_at,winner_user_id,winner_name,created_at) VALUES
('mtl_aw_cur','${mtl}','${period}','Top learner earns a trip to the Montreal grow.','Covers a facility tour + a batch-launch dinner with the team.',${now + 1900000000},NULL,NULL,${now});`);
sx(
  `INSERT OR IGNORE INTO portal_members (id,brand_id,user_id,role,source,created_at) VALUES ('mtl_pm_admin','${mtl}','${mtlAdmin}','admin','org',${now});`,
);

console.log(`  [seed] mtl(${mtl}) content — products, decks, quizzes, feed, chat, banners, scores`);

// ─── deck PDFs — real roadie refs (staging only; local roadie is inert) ───────
// Every deck above is inserted with a placeholder `pdf_ref` literal (e.g.
// 'seed-pdf-garlic') — never a real roadie reference, so the flip viewer's
// `getDeckReadUrl` always got `reference_not_found` and degraded to "Preview
// needs R2" even when R2/roadie were fully provisioned. Upload the generated
// placeholder PDFs (scripts/deck-assets/<deckId>.pdf) the same way MTL's
// logo/hero go through `roadiePut`, then repoint `pdf_ref` at the real ref.
if (staging) {
  console.log("\n[seed] uploading deck PDFs to R2 (roadie refs)…");
  const deckIds = [
    "seed_d_garlic",
    "seed_d_preroll",
    "demo_d_terpenes",
    "demo_d_indica",
    "demo_d_rosin",
    "demo_db_hash101",
    "demo_db_solventless",
    "mtl_d_lineup",
    "mtl_d_terps",
    "mtl_d_sell",
  ];
  for (const deckId of deckIds) {
    const file = `${deckAssetsDir}/${deckId}.pdf`;
    if (!existsSync(file)) continue;
    const ref = await roadiePut(file, "application/pdf", "deck-pdf", deckId);
    sx(`UPDATE decks SET pdf_ref='${esc(ref)}' WHERE id='${esc(deckId)}';`);
  }
}

// ═══ summary ══════════════════════════════════════════════════════════════════
console.log("\n[seed] DONE ✅");
if (staging) {
  console.log("  Sign in:     https://identity-staging.sproutportal.ca");
  console.log("  Acme portal: https://sprout-staging.sproutportal.ca/b/acme");
  console.log("  Beta portal: https://sprout-staging.sproutportal.ca/b/beta");
  console.log("  MTL portal:  https://sprout-staging.sproutportal.ca/b/mtl");
  console.log(`  admin@sproutportal.ca / ${PW}   (Acme — dedicated brand admin)`);
  console.log(`  alice@example.com     / ${PW}   (Acme admin)`);
  console.log(`  bob@example.com       / ${PW}   (Budtender — portal member, not org)`);
  console.log(`  dave@example.com      / ${PW}   (Beta admin)`);
  console.log(`  super@user.com        / ${PW}   (platform admin → /sprout-admin)`);
} else {
  console.log("  Acme portal: https://acme.sprout.sproutportal.localhost/");
  console.log("  Beta portal: https://beta.sprout.sproutportal.localhost/");
  console.log("  MTL portal:  https://mtl.sprout.sproutportal.localhost/");
  console.log("  alice@example.com / alicepwd123   (Acme admin)");
  console.log("  bob@example.com   / bobpwd1234    (budtender)");
  console.log("  dave@example.com  / davepwd123    (Beta admin)");
  console.log("  super@user.com    / superuserdo   (platform admin)");
}
