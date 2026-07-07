/// <reference types="bun" />
/**
 * Idempotent provisioner for sprout's Cloudflare RealtimeKit surfaces.
 *
 * Creates (or re-uses, if already present) everything the in-platform call room
 * needs, through the official `cloudflare` TypeScript SDK (`client.realtimeKit.*`,
 * which targets the account-scoped REST API under
 * `/accounts/{acct}/realtime/kit/…`):
 *
 *   1. an App      — one per environment (`<workerPrefix>-<env>`, e.g. sprout-staging)
 *   2. presets     — `group_call_participant` (referenced by lib/realtime.ts) + a host preset
 *   3. a webhook   — only when `--webhook-url=` is passed (e.g. recording.statusUpdate egress)
 *
 * It NEVER mutates anything that already matches by name/url — re-running is a
 * no-op that just re-prints the resulting ids. Pass `--dry-run` to print the
 * planned actions without calling the write endpoints.
 *
 * Auth: a Cloudflare API token with the "Realtime / Realtime Admin" permission,
 * read from `CLOUDFLARE_API_TOKEN` (falling back to `CLOUDFLARE_API_KEY`). The
 * account defaults to `platformDeployConfig.cloudflareAccountId`
 * (packages/config/src/deploy.ts) and can be overridden with
 * `CLOUDFLARE_ACCOUNT_ID`.
 *
 * NOTE on the runtime credential: creating an App does NOT return a secret — the
 * Worker authenticates with its own scoped `RTK_API_TOKEN` (a `provided` secret,
 * see packages/secrets/src/manifest.ts), not a per-app key. This script only
 * emits the `RTK_APP_ID` to wire; mint the runtime `RTK_API_TOKEN` separately and
 * scope it to Realtime only.
 *
 *   bun scripts/provision-realtimekit.ts --env=staging
 *   bun scripts/provision-realtimekit.ts --env=production --webhook-url=https://sprout.example/webhooks/realtimekit
 *   bun scripts/provision-realtimekit.ts --env=staging --dry-run
 */
import Cloudflare from "cloudflare";
import { platformDeployConfig } from "@greenroom/config";

// ---- args ------------------------------------------------------------------

const args = new Map<string, string>();
const flags = new Set<string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (!m) continue;
  if (m[2] === undefined) flags.add(m[1]!);
  else args.set(m[1]!, m[2]);
}

const ENV = (args.get("env") ?? "staging") as "staging" | "production";
if (ENV !== "staging" && ENV !== "production") {
  console.error(`--env must be "staging" or "production" (got "${args.get("env") ?? ""}")`);
  process.exit(1);
}
const DRY_RUN = flags.has("dry-run");
const WEBHOOK_URL = args.get("webhook-url");
const APP_NAME = args.get("app-name") ?? `${platformDeployConfig.workerPrefix}-${ENV}`;

const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? platformDeployConfig.cloudflareAccountId;

if (!TOKEN) {
  console.error("Set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_KEY) — a token with Realtime Admin.");
  process.exit(1);
}

// One SDK client for the whole run; every realtimeKit call takes `account_id` as
// its path param (and the App id as the leading arg, once we know it).
const cf = new Cloudflare({ apiToken: TOKEN });

/** Does a thrown SDK error mean the token lacks the Realtime scope (CF code 10000)? */
function isRealtimeScopeError(e: unknown): boolean {
  // 401/403 surface as the SDK's status-keyed subclasses. The code-10000 branch
  // additionally catches "token valid but Realtime not onboarded/unscoped", which
  // can arrive with a different status.
  if (
    e instanceof Cloudflare.AuthenticationError ||
    e instanceof Cloudflare.PermissionDeniedError
  ) {
    return true;
  }
  if (!(e instanceof Cloudflare.APIError)) return false;
  return e.errors?.some((err) => err.code === 10000) ?? false;
}

// ---- presets ---------------------------------------------------------------

interface Preset {
  name: string;
  config: Record<string, unknown>;
  permissions: Record<string, unknown>;
  ui?: Record<string, unknown>;
}

/**
 * Starting-point presets. `group_call_participant` is the name lib/realtime.ts
 * mints participants against — keep it in sync. These are sane defaults; tune the
 * permission/UI schema in the RealtimeKit dashboard once the App exists. The SDK's
 * preset param types are far more granular than this loose shape, so each body is
 * cast to the SDK type at the call site (the script fails soft on preset errors).
 */
const PRESETS: Preset[] = [
  {
    name: "group_call_participant",
    config: {
      view_type: "GROUP_CALL",
      max_screenshare_count: 1,
      max_video_streams: { tile_count: 12 },
    },
    permissions: {
      accept_waiting_requests: false,
      can_edit_display_name: false,
      kick_participant: false,
      mute_participant: false,
      pin_participant: false,
      media: {
        video: { can_produce: "ALLOWED" },
        audio: { can_produce: "ALLOWED" },
        screenshare: { can_produce: "ALLOWED" },
      },
    },
  },
  {
    name: "group_call_host",
    config: {
      view_type: "GROUP_CALL",
      max_screenshare_count: 1,
      max_video_streams: { tile_count: 12 },
    },
    permissions: {
      accept_waiting_requests: true,
      can_edit_display_name: true,
      kick_participant: true,
      mute_participant: true,
      pin_participant: true,
      recorder_type: "NONE",
      media: {
        video: { can_produce: "ALLOWED" },
        audio: { can_produce: "ALLOWED" },
        screenshare: { can_produce: "ALLOWED" },
      },
    },
  },
];

// ---- provisioning steps ----------------------------------------------------

interface App {
  id: string;
  name: string;
}

async function preflight(): Promise<void> {
  try {
    await cf.realtimeKit.apps.get({ account_id: ACCOUNT_ID });
  } catch (e) {
    if (isRealtimeScopeError(e)) {
      console.error(
        "\n✗ Authentication error on the RealtimeKit API.\n" +
          "  The token is valid but lacks the Realtime permission (or RealtimeKit\n" +
          "  isn't onboarded on this account). Edit the token in the Cloudflare\n" +
          "  dashboard → My Profile → API Tokens and add 'Realtime' + 'Realtime\n" +
          `  Admin' on account ${ACCOUNT_ID}, then re-run.\n`,
      );
      process.exit(1);
    }
    throw e;
  }
}

async function findOrCreateApp(name: string): Promise<App> {
  const list = await cf.realtimeKit.apps.get({ account_id: ACCOUNT_ID });
  const existing = (list.data ?? []).find((a) => a.name === name);
  if (existing?.id) {
    console.log(`• App "${name}" already exists → ${existing.id}`);
    return { id: existing.id, name };
  }
  if (DRY_RUN) {
    console.log(`• [dry-run] would create App "${name}"`);
    return { id: "<dry-run-app-id>", name };
  }
  const created = await cf.realtimeKit.apps.post({ account_id: ACCOUNT_ID, name });
  const id = created.data?.app?.id;
  if (!id) throw new Error(`App create for "${name}" returned no id`);
  console.log(`• Created App "${name}" → ${id}`);
  return { id, name };
}

async function ensurePreset(appId: string, preset: Preset): Promise<void> {
  try {
    const list = await cf.realtimeKit.presets.get(appId, { account_id: ACCOUNT_ID });
    if ((list.data ?? []).some((p) => p.name === preset.name)) {
      console.log(`  – preset "${preset.name}" already exists`);
      return;
    }
    if (DRY_RUN) {
      console.log(`  – [dry-run] would create preset "${preset.name}"`);
      return;
    }
    // The SDK's Config/Permissions/UI types are far more granular than these
    // hand-authored defaults — cast through `unknown` to the param type; a schema
    // mismatch surfaces at runtime and is caught + warned below.
    await cf.realtimeKit.presets.create(appId, {
      account_id: ACCOUNT_ID,
      name: preset.name,
      config: preset.config,
      permissions: preset.permissions,
      ui: preset.ui ?? {},
    } as unknown as Cloudflare.RealtimeKit.PresetCreateParams);
    console.log(`  – created preset "${preset.name}"`);
  } catch (e) {
    // Presets carry a large, evolving schema — never let one failure abort the
    // whole run. Warn with the cause + dashboard fallback and keep going.
    console.warn(
      `  ! preset "${preset.name}" not provisioned: ${(e as Error).message}\n` +
        `    Create it in the dashboard or adjust its body in this script.`,
    );
  }
}

async function ensureWebhook(appId: string, url: string): Promise<void> {
  const events: Cloudflare.RealtimeKit.WebhookCreateWebhookParams["events"] = [
    "meeting.started",
    "meeting.ended",
    "meeting.participantJoined",
    "meeting.participantLeft",
    "recording.statusUpdate",
  ];
  try {
    const list = await cf.realtimeKit.webhooks.getWebhooks(appId, { account_id: ACCOUNT_ID });
    if ((list.data ?? []).some((h) => h.url === url)) {
      console.log(`• Webhook for ${url} already exists`);
      return;
    }
    if (DRY_RUN) {
      console.log(`• [dry-run] would register webhook → ${url}`);
      return;
    }
    await cf.realtimeKit.webhooks.createWebhook(appId, {
      account_id: ACCOUNT_ID,
      name: `${APP_NAME} webhook`,
      url,
      events,
      enabled: true,
    });
    console.log(`• Registered webhook → ${url}`);
  } catch (e) {
    console.warn(`! webhook not provisioned: ${(e as Error).message}`);
  }
}

// ---- run -------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `Provisioning RealtimeKit for "${APP_NAME}" (env=${ENV}) on account ${ACCOUNT_ID}` +
      (DRY_RUN ? " [dry-run]" : ""),
  );
  await preflight();

  const app = await findOrCreateApp(APP_NAME);
  for (const preset of PRESETS) await ensurePreset(app.id, preset);
  if (WEBHOOK_URL) await ensureWebhook(app.id, WEBHOOK_URL);
  else console.log("• Skipping webhook (pass --webhook-url=… to register one)");

  console.log(
    `\n✓ Done. Wire the Worker secret for ${ENV}:\n` +
      `    RTK_APP_ID=${app.id}\n` +
      `    RTK_API_TOKEN=<a Realtime-scoped Cloudflare API token>   (mint separately)\n` +
      `  CF_ACCOUNT_ID is already a wrangler var (rendered from deploy.ts).\n` +
      `  Set them with:  bun run secrets   (RTK_* are 'provided' secrets in the manifest)`,
  );
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
