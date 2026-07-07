# P7.B — Mobile wrapper + push (delivery note)

> **Scope.** Per [09 §P7](./09-roadmap-and-cadence.md#p7--reach), the mobile
> wrapper is a **separate distribution artifact, NOT a Cloudflare Worker deploy**.
> The Sprout worker (`workers/sprout`) and everything it owns is **complete through
> P7.A**; this note records the status of P7.B and what remains, so the spec is
> fully accounted for.

## What is already built (worker-side — the part push rides)

P7.B push "rides the per-brand/per-type `notification_prefs` (never a global
switch); the DO broadcast + notification channel already exist." All of that is
**committed and live in the worker**:

- **`notifications` + `notification_prefs`** tables (migration 0005), with the
  closed 8-type enum.
- **`lib/notify.ts` `emitNotification(...)`** — the in-platform delivery channel,
  honouring the granular per-user/per-brand/per-type preference (default-on, no
  global switch). Every P3/P4/P5 emitter (new_post, new_comment, chat,
  contact_reply, session_reminder, award, access_approved, fulfilment_status)
  already routes through it.
- **`lib/notifications.functions.ts`** — `listNotifications`, `markRead`,
  `markAllRead`, `getNotificationPrefs`, `setNotificationPref` (the documented
  `brandId`-from-input exception with a server-side membership assert), plus the
  `/hub/notifications` settings grid and the `NotificationBell` poll-v1.
- **The Durable Object (`GroupChatRoom`)** real-time broadcast channel (P3.A) for
  in-section live updates.

A push provider therefore only needs to **read the same `notification_prefs`** and
fan a notification out to the device — it adds a transport, not a new policy.

## What the mobile artifact is (separate deliverable)

A thin native shell that wraps the one-page portal web view:

1. **Shell** — a Capacitor (or Expo) app that loads `<slug>.sproutportal.ca` in a
   secured web view, with native chrome (status bar, safe-area insets, back
   handling) and the platform session bridged from the system browser.
2. **Push registration** — on launch the shell registers the device token with a
   new worker endpoint (`registerPushToken`, a thin sibling of
   `setNotificationPref`) keyed by `user_id`; a queue/cron consumer pushes a
   notification to the registered tokens **after** `emitNotification` writes the
   row, filtered by the _same_ `notification_prefs` check (so a per-type opt-out
   suppresses the push exactly as it suppresses the in-app badge).
3. **Provider** — FCM (Android) / APNs (iOS) via a push provider; this is a
   **provisioning prerequisite** (account + credentials), in the same class as the
   other 09 §8 items (R2, Vectorize, RealtimeKit, Browser Rendering, the wildcard
   cert). It is inert until provisioned.

## Status

- **Worker-side notification infrastructure push rides:** ✅ complete (committed).
- **Mobile shell + push transport:** a separate distribution artifact + a push
  provider credential — **deferred as out-of-worker-scope** exactly as the plan
  specifies. When built, it reuses `notification_prefs` verbatim; no schema or
  policy change is required.
