/**
 * `GET /media/:mediaId` — streams a published Publisher media object's bytes
 * (RFC-0001 D9, open decision 6). Publisher owns the bare `/media/` prefix;
 * Store media is served separately under `/api/store/media/:id`, so a bare id
 * here always resolves through `PublisherPublic.openPublishedMedia`, which
 * returns the storage `Response` (content-type + cache headers) only for a
 * publicly-referenced id (INV-MEDIA-1) and `not_found` otherwise.
 *
 * The upstream `Response` passes through untouched — Site never re-encodes the
 * body or rewrites its headers.
 */
import type { APIRoute } from "astro";
import { openPublishedMedia } from "../../lib/publisher-public";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const mediaId = params.mediaId;
  if (!mediaId) {
    return new Response(null, { status: 404 });
  }

  let result: Awaited<ReturnType<typeof openPublishedMedia>>;
  try {
    result = await openPublishedMedia(mediaId);
  } catch {
    return new Response(null, { status: 502 });
  }

  if (!result.ok) {
    return new Response(null, { status: 404 });
  }
  return result.value;
};
