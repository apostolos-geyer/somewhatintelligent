/**
 * Server-side bridge to the GroupChatRoom Durable Object. Gated server fns call
 * `fanoutToRoom(...)` AFTER persisting to D1 (the durable log) to relay a frame
 * to every connected socket; the DO itself does no persistence. One DO instance
 * per keyspace via idFromName — group chat = brandId, feed comments = brandId:postId.
 */
import { env } from "cloudflare:workers";

/** Canonical room name. Group chat = brandId; feed comments = `brandId:postId`. */
export function roomName(brandId: string, postId?: string): string {
  return postId ? `${brandId}:${postId}` : brandId;
}

function stub(name: string) {
  return env.GROUP_CHAT_ROOM.get(env.GROUP_CHAT_ROOM.idFromName(name));
}

/** Relay a frame to all sockets in a room (best-effort; never blocks the write). */
export async function fanoutToRoom(name: string, frame: unknown): Promise<void> {
  try {
    await stub(name).fanout(JSON.stringify(frame));
  } catch {
    // The DO relay is best-effort: a failed fanout must never fail the D1 write
    // that already committed. Clients reconcile from the durable log on reconnect.
  }
}

/** Online user ids in a room (for the Hub "N online"); [] on any error. */
export async function getRoomOnline(name: string): Promise<string[]> {
  try {
    return await stub(name).getOnline();
  } catch {
    return [];
  }
}
