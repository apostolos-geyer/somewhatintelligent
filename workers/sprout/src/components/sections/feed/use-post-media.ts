import { useEffect, useState } from "react";
import { getPostMediaReadUrl } from "@/lib/feed.functions";

export type PostMediaUrlState =
  | { phase: "loading" }
  | { phase: "ready"; url: string }
  | { phase: "unavailable" };

/**
 * Resolve a post media ref to its signed read URL (roadie inert in local dev →
 * `unavailable`, never a broken frame). The post id is the tenancy boundary: a
 * forged mediaRef resolves to `{ url: null }`.
 */
export function usePostMediaUrl(postId: string, mediaRef: string): PostMediaUrlState {
  const [state, setState] = useState<PostMediaUrlState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const res = await getPostMediaReadUrl({ data: { postId, mediaRef } });
        if (cancelled) return;
        setState(res.url ? { phase: "ready", url: res.url } : { phase: "unavailable" });
      } catch {
        if (!cancelled) setState({ phase: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, mediaRef]);

  return state;
}
