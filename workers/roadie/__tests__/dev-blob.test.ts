/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { createExecutionContext, env } from "cloudflare:test";
import handler from "../src/index";
import type { RoadieEnv } from "../src/roadie-env";
import { bytes } from "./helpers";

// The dev blob route (`GET /__dev/blob/<id>`) closes the offline read
// round-trip: bytes written into the miniflare R2 sim are servable back. It
// is mounted only when ENVIRONMENT === "development"; deployed roadie keeps
// the ADR-RD-001 404 for every path but /__version.
function devEnv(overrides: Partial<RoadieEnv> = {}): RoadieEnv {
  return { ...(env as unknown as RoadieEnv), ENVIRONMENT: "development", ...overrides };
}

function fetchDev(request: Request, e: RoadieEnv): Promise<Response> {
  return handler.fetch!(request, e, createExecutionContext());
}

async function seedBlob(contentType: string, payload: Uint8Array): Promise<string> {
  const id = "pb_" + Math.random().toString(36).slice(2);
  await env.BLOBS.put(id, payload, { httpMetadata: { contentType } });
  return id;
}

describe("dev blob route", () => {
  test("streams put() bytes back with the stored content-type in development", async () => {
    const payload = bytes("dev-blob-" + Math.random());
    const id = await seedBlob("image/png", payload);

    const res = await fetchDev(
      new Request(`https://roadie.somewhatintelligent.localhost/__dev/blob/${id}`),
      devEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe(String(payload.length));
    expect(res.headers.get("cache-control")).toContain("private");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(payload);
  });

  test("PUT stores bytes into the R2 sim, servable back by GET", async () => {
    const id = "pb_" + Math.random().toString(36).slice(2);
    const payload = bytes("dev-put-" + Math.random());
    const put = await fetchDev(
      new Request(`https://roadie.somewhatintelligent.localhost/__dev/blob/${id}`, {
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: payload,
      }),
      devEnv(),
    );
    expect(put.status).toBe(204);

    const get = await fetchDev(
      new Request(`https://roadie.somewhatintelligent.localhost/__dev/blob/${id}`),
      devEnv(),
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(payload);
  });

  test("PUT is rejected outside development (deployed 404 unchanged)", async () => {
    const res = await fetchDev(
      new Request("https://x/__dev/blob/pb_x", { method: "PUT", body: bytes("x") }),
      devEnv({ ENVIRONMENT: "staging" }),
    );
    expect(res.status).toBe(404);
  });

  test("PUT rejects ids carrying separators (path traversal)", async () => {
    const res = await fetchDev(
      new Request("https://x/__dev/blob/a%2F..%2Fb", { method: "PUT", body: bytes("x") }),
      devEnv(),
    );
    expect(res.status).toBe(400);
  });

  test("404 when ENVIRONMENT is not development (deployed 404 unchanged)", async () => {
    const id = await seedBlob("text/plain", bytes("x"));
    const res = await fetchDev(
      new Request(`https://x/__dev/blob/${id}`),
      devEnv({ ENVIRONMENT: "staging" }),
    );
    expect(res.status).toBe(404);
  });

  test("404 on a missing blob", async () => {
    const res = await fetchDev(new Request("https://x/__dev/blob/pb_missing"), devEnv());
    expect(res.status).toBe(404);
  });

  test("400 on ids carrying separators (path traversal)", async () => {
    for (const bad of ["a%2Fb", "%2Fetc%2Fpasswd", "a%2F..%2Fb"]) {
      const res = await fetchDev(new Request(`https://x/__dev/blob/${bad}`), devEnv());
      expect(res.status).toBe(400);
    }
  });

  test("400 on an empty id; non-GET falls through to 404", async () => {
    const empty = await fetchDev(new Request("https://x/__dev/blob/"), devEnv());
    expect(empty.status).toBe(400);

    const post = await fetchDev(
      new Request("https://x/__dev/blob/pb_x", { method: "POST" }),
      devEnv(),
    );
    expect(post.status).toBe(404);
  });
});
