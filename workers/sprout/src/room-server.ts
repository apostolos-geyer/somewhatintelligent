/**
 * GroupChatRoom — the ONE real-time Durable Object for Sprout (binding
 * GROUP_CHAT_ROOM, v1 FROZEN at new_sqlite_classes:['GroupChatRoom']). It serves
 * BOTH keyspaces via idFromName:
 *   - group chat        = idFromName(brandId)            (one instance per brand)
 *   - feed live-comments = idFromName(`${brandId}:${postId}`) (one per post)
 * A brand room and a post-comment room are the same shape (live socket fan-out +
 * presence), so one class serves both; the durable log is D1 (chat_messages /
 * comments), NOT the DO. Send path = a gated server fn writes D1 then calls this
 * DO's `fanout()` RPC; receive path = clients subscribe over /ws and get frames.
 *
 * TENANT GATE (P3.A, non-negotiable): a connection is admitted only when the
 * WS-upgrade Host resolves (via org_brand_directory) to THIS room's brand AND the
 * verified actor is a MEMBER of that brand — platform-admin (god-mode) OR a
 * `portal_members` row for the room's brandId (the audience layer that covers
 * budtenders, whose activeOrgId is always null, plus org staff lazily synced into
 * portal_members on their first REST portal load). It deliberately does NOT gate on
 * `envelope.activeOrgId`: active org and viewed brand are orthogonal (a budtender
 * has no active org; a legitimate cross-brand admin viewing this brand carries a
 * different org active), so the old `activeOrgId === brandId` gate wrongly rejected
 * both. Mirrors the REST audience logic in `lib/brand-context.server.ts`. So a
 * brand-A member can never open brand-B's room even if a room id leaks. expectedHost
 * is pinned to SPROUT_URL in dev (matching the dev stamper) and derived
 * per-connection from the brand Host in staging/production (where bouncer signs the
 * real host).
 */
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";
import {
  createBouncerEnvelopeVerifier,
  EnvelopeRejection,
  type PlatformEnvironment,
} from "@greenroom/auth";
import { BOUNCER_ATTESTATION_KEYS } from "@greenroom/config";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { getPortalRole } from "@/lib/portal-members";
import { isPlatformAdmin } from "@/lib/policy.server";
import { chatMessages, chatRooms, comments, orgBrandDirectory, presence } from "@/schema";
import type { SproutEnv } from "./sprout-env";
import { BRAND_COOKIE, resolveBrandSlug } from "./lib/brand-resolution";

const WS_CLOSE_POLICY = 1008;
const HISTORY_LIMIT = 60;

/** Minimal cookie read off the WS-upgrade request — `path`-mode brand selection
 * rides the `sprout_brand` cookie, which (unlike the page path) is present on the
 * upgrade headers, exactly like the session cookie the envelope verifier reads. */
function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

interface ConnState {
  userId: string;
  displayName: string;
  team: boolean;
}

interface HistoryRow {
  id: string;
  user_id: string;
  author_name: string;
  body: string;
  team: number;
  heart_count: number | null;
  created_at: number;
}

export class GroupChatRoom extends Server<SproutEnv> {
  static options = { hibernate: true };

  /** Room name → brand + optional post. Group chat: "<brandId>". Feed comments:
   * "<brandId>:<postId>". brandId is the tenant key the gate binds to. */
  private parseName(): { brandId: string; postId: string | null } {
    const [brandId, postId] = this.name.split(":");
    return { brandId: brandId ?? "", postId: postId ?? null };
  }

  async onConnect(conn: Connection, ctx: ConnectionContext) {
    const reject = (reason: string) => conn.close(WS_CLOSE_POLICY, reason);
    const { brandId, postId } = this.parseName();
    if (!brandId) return reject("bad_room");

    const environment = (this.env.ENVIRONMENT ?? "development") as PlatformEnvironment;
    const wsHost = (ctx.request.headers.get("host") ?? new URL(ctx.request.url).host).toLowerCase();
    // Brand context for the connection, under the active addressing strategy:
    // the host label (subdomain mode) or the `sprout_brand` cookie (path mode).
    const slug = resolveBrandSlug({
      host: wsHost,
      brandCookie: cookieValue(ctx.request.headers.get("cookie"), BRAND_COOKIE),
    });
    if (!slug) return reject("bad_host");

    // Brand gate: the connection's brand context must resolve to THIS room's brand.
    const db = createDb(this.env.DB);
    const dir = (
      await db
        .select({ orgId: orgBrandDirectory.orgId })
        .from(orgBrandDirectory)
        .where(eq(orgBrandDirectory.slug, slug))
        .limit(1)
    ).at(0);
    if (!dir || dir.orgId !== brandId) return reject("host_brand_mismatch");

    const expectedHost =
      environment === "development" ? new URL(this.env.SPROUT_URL).hostname.toLowerCase() : wsHost;

    let envelope;
    try {
      const verify = createBouncerEnvelopeVerifier({
        keys: BOUNCER_ATTESTATION_KEYS,
        env: environment,
        expectedHost: () => expectedHost,
      });
      envelope = await verify(ctx.request);
    } catch (err) {
      if (err instanceof EnvelopeRejection) return reject("unauthenticated");
      throw err;
    }
    if (envelope.kind !== "valid" || !envelope.actor) return reject("unauthenticated");

    const userId = envelope.actor.id;

    // Tenant gate (membership, NOT active-org): admit the actor only if they are
    // a member of THIS room's brand — platform-admin (god-mode) OR a
    // `portal_members` row for `brandId`. This mirrors the REST audience gate in
    // `lib/brand-context.server.ts`, minus the org-role hop.
    //
    // Tradeoff — 2-way (platform-admin OR portal_members), no org-role fallback:
    // the REST gate's third branch (`getCallerOrgRole` → guestlist service
    // binding) is intentionally omitted here. `getCallerOrgRole` authenticates as
    // the caller by forwarding their session cookie from the ambient react-start
    // request context, which a Durable Object's onConnect (invoked directly via
    // idFromName/fetch, outside the react-start pipeline) does not establish — so
    // the org hop is unreliable from the DO isolate. Per the isolation plan
    // (docs/sprout/11-…, "Realtime / edge verdicts"), a pure `portal_members`
    // check is sufficient and I/O-cheap because the REST audience gate lazily
    // syncs org staff into `portal_members` on their first portal load.
    //
    // One edge case this leaves: a brand-new org admin who opens the socket
    // BEFORE ever loading the REST portal has no `portal_members` row yet and is
    // rejected here until that first portal load performs the lazy org→portal
    // sync. Platform admins and any actor who has loaded the portal once are
    // unaffected. `getPortalRole` runs `createDb(env.DB)` off the cloudflare:workers
    // env global, which resolves inside the DO (same binding scope as this.env.DB).
    if (!isPlatformAdmin(envelope.actor.role) && (await getPortalRole(brandId, userId)) === null) {
      return reject("not_member");
    }

    const displayName = envelope.actor.name ?? userId;
    const state: ConnState = { userId, displayName, team: false };
    conn.setState(state);

    // History from D1 (the durable log), oldest-first for the client to append.
    const rows: HistoryRow[] = postId
      ? await db
          .select({
            id: comments.id,
            user_id: comments.userId,
            author_name: comments.authorName,
            body: comments.body,
            team: comments.brandTeam,
            heart_count: comments.heartCount,
            created_at: comments.createdAt,
          })
          .from(comments)
          .where(and(eq(comments.postId, postId), isNull(comments.deletedAt)))
          .orderBy(desc(comments.createdAt))
          .limit(HISTORY_LIMIT)
      : await db
          .select({
            id: chatMessages.id,
            user_id: chatMessages.userId,
            author_name: chatMessages.authorName,
            body: chatMessages.body,
            team: chatMessages.team,
            heart_count: sql<number | null>`NULL`,
            created_at: chatMessages.createdAt,
          })
          .from(chatMessages)
          .where(and(eq(chatMessages.brandId, brandId), isNull(chatMessages.deletedAt)))
          .orderBy(desc(chatMessages.createdAt))
          .limit(HISTORY_LIMIT);

    const messages = rows
      .slice()
      .reverse()
      .map((r) => ({
        id: r.id,
        userId: r.user_id,
        authorName: r.author_name,
        body: r.body,
        team: r.team === 1,
        heartCount: r.heart_count ?? 0,
        createdAt: r.created_at,
      }));

    conn.send(
      JSON.stringify({ type: "session.init", you: state, messages, online: this.onlineUserIds() }),
    );

    // Presence: announce join on the 1→N transition, flush "last seen" (chat only).
    this.broadcast(JSON.stringify({ type: "presence.joined", userId, displayName }), [conn.id]);
    if (!postId) {
      await this.flushPresence(brandId, userId).catch(() => {});
    }
  }

  async onClose(conn: Connection) {
    const s = conn.state as ConnState | null;
    if (!s) return;
    if (this.connectionCountForUser(s.userId, conn.id) > 0) return; // other tab still open
    this.broadcast(JSON.stringify({ type: "presence.left", userId: s.userId }));
  }

  async onMessage(conn: Connection, raw: WSMessage) {
    // The authoritative send path is a gated server fn (D1 write → fanout RPC).
    // Over the socket we accept only ephemeral typing pings.
    if (typeof raw !== "string") return;
    const s = conn.state as ConnState | null;
    if (!s) return;
    let parsed: { type?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { type?: unknown };
    } catch {
      return;
    }
    if (parsed?.type === "typing") {
      this.broadcast(
        JSON.stringify({ type: "typing", userId: s.userId, displayName: s.displayName }),
        [conn.id],
      );
    }
  }

  /**
   * Fan a frame out to every connected socket. Called by server fns over RPC
   * AFTER they persist to D1 (the durable log) — keeps auth + persistence in the
   * gated server fn and the DO purely a live relay.
   */
  async fanout(frame: string): Promise<void> {
    this.broadcast(frame);
  }

  /** Online user ids (for the Hub "N online"). */
  async getOnline(): Promise<string[]> {
    return this.onlineUserIds();
  }

  private onlineUserIds(): string[] {
    const ids = new Set<string>();
    for (const c of this.getConnections()) {
      const st = c.state as ConnState | null;
      if (st) ids.add(st.userId);
    }
    return [...ids];
  }

  private connectionCountForUser(userId: string, excludeConnId: string): number {
    let n = 0;
    for (const c of this.getConnections()) {
      if (c.id === excludeConnId) continue;
      const st = c.state as ConnState | null;
      if (st?.userId === userId) n++;
    }
    return n;
  }

  /** Coarse "last seen" mirror so the Hub can show presence without a socket. */
  private async flushPresence(brandId: string, userId: string): Promise<void> {
    const db = createDb(this.env.DB);
    const room = (
      await db
        .select({ id: chatRooms.id })
        .from(chatRooms)
        .where(eq(chatRooms.brandId, brandId))
        .limit(1)
    ).at(0);
    if (!room) return;
    const lastSeenAt = Date.now();
    await db
      .insert(presence)
      .values({ roomId: room.id, userId, lastSeenAt })
      .onConflictDoUpdate({
        target: [presence.roomId, presence.userId],
        set: { lastSeenAt },
      });
  }
}
