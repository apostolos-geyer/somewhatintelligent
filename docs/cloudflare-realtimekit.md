# Cloudflare RealtimeKit — research synthesis + implementation plan

> Source: <https://developers.cloudflare.com/realtime/llms.txt> (docs current as of
> 2026-06). Reference implementation: [`cloudflare/meet`](https://github.com/cloudflare/meet).
> This doc synthesizes the product, reconciles it against what already exists in
> this repo, and lays out the remaining work to make in-platform live video/voice
> actually render.

## TL;DR for this repo

RealtimeKit is **already integrated server-side** in `workers/sprout`
(`src/lib/realtime.ts`) and the booking/session lifecycle around it is built. The
design **matches Cloudflare's own recommended scheduling pattern** (backend owns
the schedule + join-gate, mints a per-participant token on join).

**Decided + done (this branch):** the seam was migrated to the **account-scoped
Bearer API** (`api.cloudflare.com/client/v4/accounts/{acct}/realtime/kit/...`)
and then off hand-rolled `fetch` entirely onto the **official `cloudflare`
TypeScript SDK** (`client.realtimeKit.*`) — both the runtime seam
(`lib/realtime.ts`) and the provisioner (`scripts/provision-realtimekit.ts`) now
call the typed SDK; the SDK owns the URL, the `Bearer` header, and the
`{ success, data }` envelope. Its credentials were formalized in the secrets
manifest (`RTK_APP_ID` + `RTK_API_TOKEN`, with `CF_ACCOUNT_ID` exposed as a
wrangler var), and the idempotent provisioner creates the App + presets
(+ optional webhook). The **client meeting UI is now wired** too:
`@cloudflare/realtimekit-react` + `-react-ui` are installed and `CallRoom`
mounts a real `<RtkMeeting>` (lazy + `<ClientOnly>`, so the browser-only UI Kit
stays off SSR and the portal's initial bundle). See [§3](#api-surfaces) and
[§7](#7-implementation-plan).

**Still outstanding:**

1. **The token must carry the `Realtime / Realtime Admin` permission.** The
   Cloudflare token currently in this environment is valid but **lacks** that
   scope — every `realtime/kit` resource returns `Authentication error` (code
   `10000`) on both accounts, while `tokens/verify` and account-listing succeed.
   Grant the scope (or mint a scoped token) before the provisioner or the live
   seam can call the API.
2. **Auto-recording start + webhook receiver** are not wired (the cron poll in
   `archiveRecording` still works); see [§4](#4-recording--r2-egress) / Phase 4.

---

## 1. What RealtimeKit is

Cloudflare Realtime ships **three layers**; pick the highest one that meets your
needs:

| Layer                           | What it is                                                                                                                                                                  | When to use                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Realtime TURN**               | Managed STUN/TURN relay for WebRTC traffic through NATs/firewalls. Transparent to standard WebRTC libs.                                                                     | You already have signaling + media logic and just need relay.          |
| **Realtime SFU**                | Selective Forwarding Unit — global low-latency media routing (push/pull tracks). You hand-build negotiation, presence, recording.                                           | You have WebRTC expertise and want full control of media.              |
| **RealtimeKit** (formerly Dyte) | Batteries-included video/voice: SDKs + UI components + backend REST (meetings, participants, recording) + webhooks + a signaling server, all sitting **on top of** the SFU. | You want "add live video/voice in minutes." **← what this repo uses.** |

RealtimeKit handles media-track management, peer management, presence, chat,
recording, and transcription for you. The repo deliberately chose RealtimeKit
over the raw SFU (`docs/sprout/05-api-and-integrations.md:665-672`) precisely to
avoid hand-building track negotiation.

## 2. Core concepts

- **App** — a workspace that isolates meetings, participants, presets, and
  recordings. Convention: one App per environment (staging vs production) so data
  never mixes. Identified by an **App ID**; authenticated with a secret/token.
- **Meeting** — a reusable virtual room (`id`). It has **no built-in start/end
  time**; only one active session at a time. You can disable it with
  `PATCH … {"status":"INACTIVE"}` to stop new joins.
- **Session** — the live instance of a meeting; created when the first
  participant joins, ends shortly after the last leaves. Owns its own
  participants, chat history, and recordings.
- **Participant** — added via the server API, which returns a single-use
  **`authToken`**. Tokens must **never be reused** across participants. The token
  is short-lived and handed to the client SDK to join.
- **Preset** — a reusable, App-level set of permissions + meeting type
  (video/audio/webinar) + UI/branding. Presets are configured in the **dashboard**
  (or API) and referenced **by name** when adding a participant. Example:
  `webinar-host` (can share media + host controls) vs `webinar-participant`
  (chat only). **The repo references `preset_name: "group_call_participant"`
  (in `realtime.ts`'s `mintJoinToken`) — that preset must exist in the App or
  `add participant` fails.**

### Cloudflare's recommended scheduling pattern (we already do this)

RealtimeKit has no scheduler. Per the [FAQ](https://developers.cloudflare.com/realtime/realtimekit/faq/):

1. On schedule: backend creates a meeting, stores `meeting.id` + start/end.
2. On join: backend checks `now` is within the allowed window.
3. If allowed: backend adds the participant, returns the `authToken`, frontend
   passes it to the SDK.

This is exactly `lib/realtime.ts` + `lib/sessions.functions.ts` +
`CallRoom.tsx`. Join is gated on `now >= starts_at`; there is no instant-call
path by design.

## 3. API surfaces

There are **two** REST surfaces. Both are live; they differ in host + auth.

### (a) Current / documented — account-scoped, Bearer (via the `cloudflare` SDK)

```
https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/realtime/kit/{APP_ID}/...
Authorization: Bearer <CLOUDFLARE_API_TOKEN>   # token needs "Realtime / Realtime Admin"
```

The repo no longer hand-builds these requests. Both the runtime seam and the
provisioner go through the official **`cloudflare` TypeScript SDK**, which targets
the same account-scoped surface and supplies the URL + `Bearer` auth + envelope
parsing. The endpoints below map 1:1 to SDK calls:

```ts
import Cloudflare from "cloudflare";
const cf = new Cloudflare({ apiToken: RTK_API_TOKEN });

// Create app (one-time, or use dashboard)
cf.realtimeKit.apps.post({ account_id, name });
// Create meeting → data.id
cf.realtimeKit.meetings.create(appId, { account_id, title });
// Add participant → data.token (the participant auth token)
cf.realtimeKit.meetings.addParticipant(appId, meetingId, {
  account_id,
  name,
  preset_name,
  custom_participant_id,
});
// List a meeting's recordings → data[].download_url (when status === "UPLOADED")
cf.realtimeKit.recordings.getRecordings(appId, { account_id, meeting_id });
// Disable a meeting (stop new joins after the window)
cf.realtimeKit.meetings.updateMeetingById(appId, meetingId, { account_id, status: "INACTIVE" });
```

### (b) Legacy Dyte-compatible — app-scoped, Basic (what `realtime.ts` used before this branch)

```
https://api.realtime.cloudflare.com/v2/meetings
Authorization: Basic base64(appId:secret)
```

The legacy surface wraps responses in `{ data: { ... } }` and authenticates with
app-scoped Basic auth. The account-scoped surface (a) uses Bearer auth and the
`{ success, data }` envelope — so **migrating hosts was not a drop-in change**.

**Decision (implemented):** the seam was **migrated to surface (a)**, the
account-scoped Bearer API, and then off raw `fetch` onto the **`cloudflare`
SDK**. It reads `CF_ACCOUNT_ID` (wrangler var) + `RTK_APP_ID` + `RTK_API_TOKEN`
(secret) into `new Cloudflare({ apiToken })`, passes `account_id` as the path
param and `RTK_APP_ID` as the leading arg, and reads the meeting id from
`res.data.id` / participant token from `res.data.token`. The change is entirely
inside `lib/realtime.ts` — no caller changed (the seam's `{ available }` contract
held). This unifies the runtime auth model with the provisioning script under one
typed client, and keeps Apps/presets/webhooks manageable under one Cloudflare API
token. The single remaining raw `fetch` pulls recording bytes from a presigned
storage URL — not a Cloudflare API call, so it stays a plain `fetch`.

## 4. Recording → R2 (egress)

- RealtimeKit offers **managed recording**; the recommended posture
  (`docs/sprout/05-api-and-integrations.md:673-677`) is to configure the
  recording's **S3-compatible output to write directly to the project R2 bucket**
  (the same R2 creds roadie uses), then register the object with roadie under
  `resourceType:"session-recording"`.
- **Two ways to learn a recording is ready:**
  - **Webhook `recording.statusUpdate`** — fires on state transitions; when
    `status === "UPLOADED"` the payload carries `downloadUrl` /
    `audioDownloadUrl` / `downloadUrlExpiry`. Webhooks are signed RSA-SHA256 via
    the `rtk-signature` header (verify against the fetched public key);
    `rtk-uuid` dedupes deliveries. **Preferred.**
  - **Polling** the recordings list API. This is what `archiveRecording`
    does (`realtime.ts`): `cf.realtimeKit.recordings.getRecordings(appId, {
account_id, meeting_id, sort_order: "DESC" })`, take the most recent
    `status === "UPLOADED"` one (the only status carrying a `download_url`),
    stream those bytes into roadie. Driven by the cron `ended` transition. Works
    without a public webhook endpoint, but is pull-based and re-attempts each tick.
- **Track recording** (added 2026-05-28): per-participant WebM files instead of a
  composite — `POST …/recordings/track {meeting_id, user_ids}`. Requires
  `@cloudflare/realtimekit >= 1.4.0`. Useful later for transcription/compliance;
  not needed for v1.
- Transcripts/summaries are available post-meeting via `meeting.transcript` /
  `meeting.summary` webhooks or REST (transcripts retained 7 days).

## 5. Client SDK

| Package                            | Purpose                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cloudflare/realtimekit`          | Core SDK (vanilla JS). `RealtimeKitClient.init({ authToken, defaults })` → `meeting`; `meeting.self`, `meeting.participants`, audio/video/screenshare/chat controls. |
| `@cloudflare/realtimekit-react`    | React hooks: `useRealtimeKitClient()`, `useRealtimeKitMeeting()`, `<RealtimeKitProvider>`.                                                                           |
| `@cloudflare/realtimekit-react-ui` | Prebuilt UI: `<RtkMeeting>` (full meeting UI incl. setup screen).                                                                                                    |

Minimal React mount (UI Kit):

```tsx
import { useEffect } from "react";
import { useRealtimeKitClient, RealtimeKitProvider } from "@cloudflare/realtimekit-react";
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui";

function Room({ authToken }: { authToken: string }) {
  const [meeting, initMeeting] = useRealtimeKitClient();
  useEffect(() => {
    initMeeting({ authToken, defaults: { audio: true, video: true } });
  }, [authToken]);
  return (
    <RealtimeKitProvider value={meeting}>
      <RtkMeeting mode="fill" meeting={meeting} showSetupScreen />
    </RealtimeKitProvider>
  );
}
```

The Core SDK (no UI) is the alternative if we want to render call surfaces with
our own `@greenroom/ui` chrome instead of `<RtkMeeting>`. For v1, **UI Kit is the
fast path**; Core SDK is a later refinement if the prebuilt UI clashes with brand
theming.

---

## 6. Current state in this repo

| Concern                                                                   | File                                                                                                                 | Status                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Server seam (create meeting / mint token / archive recording)             | `workers/sprout/src/lib/realtime.ts`                                                                                    | ✅ implemented (graceful `{available:false}` when unprovisioned)                                 |
| Join/leave lifecycle + attendance                                         | `workers/sprout/src/lib/sessions.functions.ts`                                                                          | ✅ implemented                                                                                   |
| Data model (`realtime_session_id`, `recording_ref`, attendance)           | `workers/sprout/src/schema.ts`                                                                                          | ✅                                                                                               |
| Admin scheduling UI (windows + group sessions)                            | `workers/sprout/src/routes/admin/calls.tsx`                                                                             | ✅                                                                                               |
| Recording egress → roadie R2                                              | `workers/sprout/src/lib/recordings.functions.ts` + `realtime.ts` (`archiveRecording`)                                   | ✅ (cron-poll)                                                                                   |
| Runtime API surface                                                       | `workers/sprout/src/lib/realtime.ts`                                                                                    | ✅ account-scoped Bearer via the `cloudflare` SDK (`client.realtimeKit.*`)                       |
| Config split: `RTK_APP_ID` + `CF_ACCOUNT_ID` vars, `RTK_API_TOKEN` secret | `workers/sprout/wrangler.jsonc` (literal vars), `deploy.ts` (`cloudflareAccountId`), `packages/secrets/src/manifest.ts` | ✅ vars in the config; only the token is a manifest secret (staging pushed, prod staged)         |
| Idempotent provisioner (App + presets + webhook)                          | `scripts/provision-realtimekit.ts`                                                                                   | ✅ via the `cloudflare` SDK (find-or-create, `--dry-run`) — needs a Realtime-scoped token to run |
| Client meeting mount                                                      | `workers/sprout/src/components/booking/{CallRoom,RealtimeMeeting}.tsx`                                                  | ✅ real `<RtkMeeting>` (lazy + `<ClientOnly>`); placeholder kept for dev/inert                   |
| Client SDK packages                                                       | `@cloudflare/realtimekit-react@1.5.1`, `-react-ui@1.2.0`                                                             | ✅ installed (code-split chunk, off the portal entry)                                            |
| Server REST SDK package                                                   | `cloudflare@6.4.0` (catalog; root devDep for the script + sprout dep for the seam)                                   | ✅ installed (`client.realtimeKit.*`; code-split into its own server chunk)                      |
| **Webhook receiver** (`recording.statusUpdate` etc.)                      | —                                                                                                                    | ❌ not built (recordings are cron-polled instead)                                                |

The design intent is documented and "SETTLED" in
`docs/sprout/05-api-and-integrations.md:665-677` and `:830-864`.

---

## 7. Implementation plan

Phased so each phase is independently shippable and the platform keeps degrading
gracefully when RealtimeKit is unprovisioned (local dev).

### Phase 0 — Provision the RealtimeKit surfaces — ✅ done (apps live on the Sprout account)

`scripts/provision-realtimekit.ts` is an idempotent (find-or-create) provisioner:

```sh
# App + presets (one App per env). Token needs Realtime / Realtime Admin.
CLOUDFLARE_API_TOKEN=<realtime-admin> bun scripts/provision-realtimekit.ts --env=staging    --app-name=sprout-staging
CLOUDFLARE_API_TOKEN=<realtime-admin> bun scripts/provision-realtimekit.ts --env=production --app-name=sprout-production
```

It reads the token from `CLOUDFLARE_API_TOKEN` (falls back to `CLOUDFLARE_API_KEY`)
and the account from `platformDeployConfig.cloudflareAccountId` (override with
`CLOUDFLARE_ACCOUNT_ID`). Creates the App, the `group_call_participant` +
`group_call_host` presets (Cloudflare seeds a default preset set on App create),
and — with `--webhook-url=` — a webhook; re-runs are no-ops. Without the Realtime
permission it exits with actionable `10000` guidance.

**Provisioned (Sprout account `30ce6004…` = Sproutcannabis@gmail.com):**

| Env             | App name            | `RTK_APP_ID` (→ `deploy.ts → rtk`)     |
| --------------- | ------------------- | -------------------------------------- |
| staging         | `sprout-staging`    | `0c1b7acb-8465-4af0-8069-68245e0bb28e` |
| production      | `sprout-production` | `aa065fe9-14b0-48dd-851d-dbc1b0a3ca20` |
| (dev, optional) | `sprout-dev`        | `c914e12c-5dcd-4144-83c6-b16aa821bd7d` |

### Phase 1 — Config / secret split + provisioning — ✅ done (staging pushed; prod deploy-gated)

The runtime needs three values; they split by sensitivity:

| Value           | Kind               | Source / where it lives                                                                                          |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `CF_ACCOUNT_ID` | non-secret **var** | `deploy.ts → cloudflareAccountId` (`30ce6004…`); also a literal `CF_ACCOUNT_ID` var in sprout's `wrangler.jsonc` |
| `RTK_APP_ID`    | non-secret **var** | literal `RTK_APP_ID` var in sprout's `wrangler.jsonc` (top level = staging id, `env.production` = prod id)       |
| `RTK_API_TOKEN` | **secret**         | minted Realtime token in gitignored `.secrets/<env>.env`; pushed by `bun run secrets <env>`                      |

So `RTK_APP_ID` is **not** in the secrets manifest — only `RTK_API_TOKEN` is
(`provided`, `required:false`, scoped to `sprout` staging+production; no `local`).
Per-env tokens were minted (`sprout-realtime-staging` / `-production`, Realtime
Admin, account-scoped) and staged in `.secrets/`.

**Push (secrets land on a deployed worker — docs/runbooks/SECRETS.md §Cutover):**

```sh
export CLOUDFLARE_ACCOUNT_ID=30ce6004… CLOUDFLARE_API_TOKEN=<admin>
bun run secrets staging    --worker sprout --only RTK_API_TOKEN   # ✅ pushed to sprout-sprout-staging
bun run secrets production --worker sprout --only RTK_API_TOKEN   # ⏳ run after sprout-sprout-production is deployed
```

Staging was pushed and verified (the token authenticates against the staging App).
The **production** App + token exist and the value is staged, but the push waits
on the first `sprout-sprout-production` deploy (that worker isn't deployed yet).
After any deploy, the new `RTK_APP_ID`/`CF_ACCOUNT_ID` vars + the secret are live;
a redeploy is needed to pick up the new vars on the already-deployed staging worker.

### Phase 2 — Wire the client meeting mount — ✅ done

- Installed `@cloudflare/realtimekit-react@1.5.1` + `@cloudflare/realtimekit-react-ui@1.2.0`
  (UI Kit fast path). For track recording later, the transitive
  `@cloudflare/realtimekit` must be `>= 1.4.0`.
- `workers/sprout/src/components/booking/RealtimeMeeting.tsx` is the mount:
  `useRealtimeKitClient()` → `initMeeting({ authToken })` → `<RealtimeKitProvider
value={meeting} fallback={…}>` → `<RtkMeeting mode="fill" showSetupScreen>`
  (device setup + the actual join live on the setup screen).
- `CallRoom.tsx` renders it only in the `ready && available && token` branch via
  **`lazy()` + `<ClientOnly>` + `<Suspense>`** — `lazy` code-splits the UI Kit off
  the portal's initial chunk (verified: own `RealtimeMeeting-*.js` client chunk,
  not in `_portal`), and `<ClientOnly>` (from `@tanstack/react-router`, the
  idiomatic primitive — preferred over `typeof window` or `createIsomorphicFn`)
  keeps the browser-only web-component/WebRTC code off SSR and the first hydration
  render. The `!available` placeholder branch is untouched (the dev/inert degrade).
- **Follow-up (not blocking):** theme `<RtkMeeting>` with brand design tokens so
  the prebuilt UI matches `@greenroom/ui`; drop to the Core SDK + custom chrome if
  it ever fights the brand.

### Phase 3 — Presets — ✅ scripted (tune in dashboard)

`provision-realtimekit.ts` creates the `group_call_participant` (matches
`realtime.ts:109`) + `group_call_host` presets per App. Without the participant
preset, `add participant` 4xxs and `mintJoinToken` returns `{available:false}`.
The preset bodies are a sane starting schema — refine permissions/UI in the
RealtimeKit dashboard once the App exists (the script fails soft on preset errors,
so a schema mismatch warns rather than aborting the run).

### Phase 4 — (optional) Webhook-driven recording

Currently recordings are cron-polled. If we want lower-latency / more reliable
egress:

1. Add a `POST /webhooks/realtimekit` route in sprout that verifies
   `rtk-signature` (RSA-SHA256 against the fetched public key), dedupes on
   `rtk-uuid`, and on `recording.statusUpdate` + `status==="UPLOADED"` runs the
   existing `archiveRecording` egress with the payload's `downloadUrl`.
2. Register the webhook with `provision-realtimekit.ts --webhook-url=…` (the
   provisioner already supports it).
3. Keep the cron poll as a backstop for missed deliveries.

This is **optional for v1** — the cron poll already works.

### Phase 5 — Migrate to account-scoped API surface — ✅ done

Done entirely inside `lib/realtime.ts`: it builds
`…/accounts/{CF_ACCOUNT_ID}/realtime/kit/{RTK_APP_ID}`, authenticates with
`Bearer {RTK_API_TOKEN}`, and reads the `{success, data}` envelope (meeting id at
`data.id`, token at `data.token`). No caller changed — the seam boundary held.

### Phase 6 — Move off raw `fetch` onto the `cloudflare` SDK — ✅ done

Both the runtime seam (`lib/realtime.ts`) and the provisioner
(`scripts/provision-realtimekit.ts`) now call the official **`cloudflare`
TypeScript SDK** (`cloudflare@6.4.0`, catalog dep) instead of hand-rolling
`fetch`:

- `createRealtimeSession` → `cf.realtimeKit.meetings.create(appId, { account_id, title })`
- `mintJoinToken` → `cf.realtimeKit.meetings.addParticipant(appId, meetingId, { account_id, name, preset_name, custom_participant_id })`
- `archiveRecording` → `cf.realtimeKit.recordings.getRecordings(appId, { account_id, meeting_id, sort_order: "DESC" })`
- provisioner → `apps.get` / `apps.post` / `presets.get` / `presets.create` / `webhooks.getWebhooks` / `webhooks.createWebhook`

The SDK owns the account-scoped URL, the `Bearer` header, and the typed
`{ success, data }` envelope, so the seam reads `res.data.id` / `res.data.token`
directly off typed responses. The client is built per call with `maxRetries: 0`
so the graceful-degrade path stays fast (no backoff stall on a user-facing Join).
The graceful-degrade contract is unchanged: absent `CF_ACCOUNT_ID` / `RTK_APP_ID`
/ `RTK_API_TOKEN`, no SDK client is constructed and every fn returns
`{ available: false }`. The **one** remaining raw `fetch` streams recording bytes
from a presigned storage URL — not a Cloudflare API call. The unit test
(`__tests__/realtime.test.ts`) now mocks the `cloudflare` SDK rather than global
`fetch`. Auto-recording _start_ (`cf.realtimeKit.recordings.startRecordings`) is
the one remaining follow-up; the cron-poll egress is unaffected.

---

## 8. Local dev & testing posture

- **Local stays inert.** No `local` secrets ⇒ `rtkConfig()` returns `null` ⇒
  every seam fn returns `{available:false}` ⇒ `CallRoom` shows the "provision
  RealtimeKit" placeholder. The booking/session/attendance D1 paths run fully
  offline, so journeys remain end-to-end exercisable without credentials
  (matches `realtime.ts:9-13`).
- **Unit/pool tests** can assert the degrade contract (token null → placeholder)
  without network. The seam's `{available:false}` return is the test seam.
- **Manual / e2e** verification of the real meeting UI needs provisioned
  `RTK_APP_ID`/`RTK_API_TOKEN` + the preset; browser automation is set up
  (`docs/browser-automation.md`) but RealtimeKit's media stack won't meaningfully
  run headless — verify the mount renders + the token is consumed, not media.

## 9. Open decisions

1. ~~**API surface:** legacy vs account-scoped.~~ **Resolved → account-scoped
   Bearer** (migrated, behind the seam).
2. ~~**UI Kit vs Core SDK** for the mount.~~ **Resolved → UI Kit** (`<RtkMeeting>`).
   Revisit Core SDK + `@greenroom/ui` chrome only if theming the prebuilt UI proves
   insufficient.
3. **Recording trigger:** keep cron-poll (works now) vs add signed webhook
   receiver (lower latency, more infra). Recommend cron-poll for v1, webhook later.

## 10. Reference links

- Overview / layers: <https://developers.cloudflare.com/realtime/>
- RealtimeKit hub: <https://developers.cloudflare.com/realtime/realtimekit/>
- Quickstart: <https://developers.cloudflare.com/realtime/realtimekit/quickstart/>
- Concepts: <https://developers.cloudflare.com/realtime/realtimekit/concepts/>
- Core SDK: <https://developers.cloudflare.com/realtime/realtimekit/core/>
- FAQ (scheduling/auth tokens): <https://developers.cloudflare.com/realtime/realtimekit/faq/>
- Webhooks: <https://developers.cloudflare.com/realtime/realtimekit/webhooks/>
- Recording status: <https://developers.cloudflare.com/realtime/realtimekit/recording-guide/monitor-status/>
- REST API reference: <https://developers.cloudflare.com/api/resources/realtime_kit/>
- Reference app: <https://github.com/cloudflare/meet>
