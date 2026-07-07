/**
 * Unit (idiom B) — the Cloudflare RealtimeKit seam (`lib/realtime.ts`).
 *
 * Proves the two things that matter about the `cloudflare` SDK migration:
 *   1. the GRACEFUL-DEGRADE contract — when CF_ACCOUNT_ID / RTK_APP_ID /
 *      RTK_API_TOKEN (or the roadie R2 binding for archive) are absent, every fn
 *      returns `{ available:false }`, makes NO SDK call, and NEVER throws (the
 *      local-dev posture the whole booking flow relies on); and
 *   2. the SDK call shapes — each `client.realtimeKit.*` method is invoked with
 *      the App id, the `account_id` path param, and the right body, and the
 *      `{ success, data }` envelope is read (`data.id` / `data.token` /
 *      `data[].download_url`).
 *
 * `cloudflare:workers` (env), `@/lib/roadie`, the `cloudflare` SDK, and global
 * `fetch` (only the recording-byte download still uses it) are mocked so this
 * stays a fast node test with zero bindings.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// `vi.mock` factories hoist above module init, so the shared mock state must be
// created in `vi.hoisted`. realtime.ts reads `env.X` at call time and constructs a
// fresh `new Cloudflare(...)` per call, so a single mutable env object lets each
// test flip config presence, and a single `rtk` object (returned by every client
// instance) lets each test own the method results. roadie is a separate seam
// stubbed so archive tests own the `put` result.
const { mockEnv, putMock, rtk, ctorSpy } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
  putMock: vi.fn(),
  rtk: {
    meetings: { create: vi.fn(), addParticipant: vi.fn() },
    recordings: { getRecordings: vi.fn() },
  },
  ctorSpy: vi.fn(),
}));
vi.mock("cloudflare:workers", () => ({ env: mockEnv }));
vi.mock("@/lib/roadie", () => ({ getRoadie: () => ({ put: putMock }) }));
vi.mock("cloudflare", () => ({
  default: class {
    realtimeKit = rtk;
    constructor(opts: unknown) {
      ctorSpy(opts);
    }
  },
}));

import { archiveRecording, createRealtimeSession, mintJoinToken } from "@/lib/realtime";

const ACCT = "acct_test";
const APP = "app_test";
const TOKEN = "tok_test";

function provision({
  rtk: hasRtk = true,
  roadie = false,
}: { rtk?: boolean; roadie?: boolean } = {}) {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  if (hasRtk) {
    mockEnv.CF_ACCOUNT_ID = ACCT;
    mockEnv.RTK_APP_ID = APP;
    mockEnv.RTK_API_TOKEN = TOKEN;
  }
  if (roadie) mockEnv.ROADIE = {};
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

describe("createRealtimeSession", () => {
  test("unprovisioned → { available:false } and makes NO SDK call", async () => {
    provision({ rtk: false });
    expect(await createRealtimeSession({ brandId: "acme", title: "1:1" })).toEqual({
      available: false,
    });
    expect(rtk.meetings.create).not.toHaveBeenCalled();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  test("creates a meeting with the App id, account_id + brand-stamped title; reads data.id", async () => {
    provision();
    rtk.meetings.create.mockResolvedValueOnce({ success: true, data: { id: "m1" } });
    expect(await createRealtimeSession({ brandId: "acme", title: "Demo" })).toEqual({
      available: true,
      sessionId: "m1",
    });
    // SDK client built with the Bearer token.
    expect(ctorSpy).toHaveBeenCalledWith(expect.objectContaining({ apiToken: TOKEN }));
    expect(rtk.meetings.create).toHaveBeenCalledWith(APP, {
      account_id: ACCT,
      title: "Demo · acme",
    });
  });

  test("degrades when data has no id, on rejection, never throws", async () => {
    provision();
    rtk.meetings.create.mockResolvedValueOnce({ success: true, data: {} });
    expect(await createRealtimeSession({ brandId: "x", title: "y" })).toEqual({ available: false });
    rtk.meetings.create.mockRejectedValueOnce(new Error("network"));
    expect(await createRealtimeSession({ brandId: "x", title: "y" })).toEqual({ available: false });
  });
});

describe("mintJoinToken", () => {
  test("unprovisioned → { available:false }, no SDK call", async () => {
    provision({ rtk: false });
    expect(await mintJoinToken("m1", "u1")).toEqual({ available: false });
    expect(rtk.meetings.addParticipant).not.toHaveBeenCalled();
  });

  test("adds a participant with preset + custom id, returns data.token", async () => {
    provision();
    rtk.meetings.addParticipant.mockResolvedValueOnce({ success: true, data: { token: "jt" } });
    expect(await mintJoinToken("m1", "u1")).toEqual({ available: true, token: "jt" });
    expect(rtk.meetings.addParticipant).toHaveBeenCalledWith(APP, "m1", {
      account_id: ACCT,
      name: "u1",
      preset_name: "group_call_participant",
      custom_participant_id: "u1",
    });
  });

  test("degrades when no token comes back, and on rejection (never throws)", async () => {
    provision();
    rtk.meetings.addParticipant.mockResolvedValueOnce({ success: true, data: {} });
    expect(await mintJoinToken("m1", "u1")).toEqual({ available: false });
    rtk.meetings.addParticipant.mockRejectedValueOnce(new Error("boom"));
    expect(await mintJoinToken("m1", "u1")).toEqual({ available: false });
  });
});

describe("archiveRecording", () => {
  test("degrades when EITHER credential is missing", async () => {
    provision({ rtk: true, roadie: false });
    expect(await archiveRecording("m1")).toEqual({ available: false });
    provision({ rtk: false, roadie: true });
    expect(await archiveRecording("m1")).toEqual({ available: false });
    expect(rtk.recordings.getRecordings).not.toHaveBeenCalled();
  });

  test("lists recordings (filtered by meeting), streams the UPLOADED one into roadie, returns ref", async () => {
    provision({ rtk: true, roadie: true });
    rtk.recordings.getRecordings.mockResolvedValueOnce({
      success: true,
      data: [{ id: "r1", status: "UPLOADED", download_url: "https://dl/r1.mp4" }],
      paging: {},
    });
    // The recording-byte download is the one step that still uses plain fetch
    // (a presigned storage URL, not a Cloudflare API call).
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "video/mp4" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as Response);
    putMock.mockResolvedValueOnce({ ok: true, value: { referenceId: "ref_1" } });

    expect(await archiveRecording("m1")).toEqual({ available: true, recordingRef: "ref_1" });
    expect(rtk.recordings.getRecordings).toHaveBeenCalledWith(
      APP,
      expect.objectContaining({ account_id: ACCT, meeting_id: "m1" }),
    );
    expect(fetchMock.mock.calls[0]![0]).toBe("https://dl/r1.mp4");
    const putArg = putMock.mock.calls[0]![0] as {
      application: unknown;
      contentType: string;
      size: number;
    };
    expect(putArg.application).toEqual({
      app: "sprout",
      resourceType: "session-recording",
      resourceId: "m1",
    });
    expect(putArg.contentType).toBe("video/mp4");
    expect(putArg.size).toBe(3);
  });

  test("picks the newest UPLOADED recording even if the API returns them oldest-first", async () => {
    provision({ rtk: true, roadie: true });
    // Server ignored sort_order: returns ascending by invoked_time. The seam must
    // still pick the newest UPLOADED (r2), not the first one in the array (r1).
    rtk.recordings.getRecordings.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: "r1",
          status: "UPLOADED",
          download_url: "https://dl/r1.mp4",
          invoked_time: "2026-01-01T00:00:00Z",
        },
        {
          id: "r2",
          status: "UPLOADED",
          download_url: "https://dl/r2.mp4",
          invoked_time: "2026-01-02T00:00:00Z",
        },
      ],
      paging: {},
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "video/mp4" },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as unknown as Response);
    putMock.mockResolvedValueOnce({ ok: true, value: { referenceId: "ref_2" } });

    expect(await archiveRecording("m1")).toEqual({ available: true, recordingRef: "ref_2" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://dl/r2.mp4");
  });

  test("degrades when no finished recording exists yet", async () => {
    provision({ rtk: true, roadie: true });
    rtk.recordings.getRecordings.mockResolvedValueOnce({
      success: true,
      data: [{ id: "r1", status: "RECORDING", download_url: null }],
      paging: {},
    });
    expect(await archiveRecording("m1")).toEqual({ available: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("degrades (never throws) when roadie put fails", async () => {
    provision({ rtk: true, roadie: true });
    rtk.recordings.getRecordings.mockResolvedValueOnce({
      success: true,
      data: [{ id: "r1", status: "UPLOADED", download_url: "https://dl/r1.mp4" }],
      paging: {},
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    } as unknown as Response);
    putMock.mockResolvedValueOnce({ ok: false, error: "too big" });
    expect(await archiveRecording("m1")).toEqual({ available: false });
  });

  test("degrades (never throws) when the SDK list call rejects", async () => {
    provision({ rtk: true, roadie: true });
    rtk.recordings.getRecordings.mockRejectedValueOnce(new Error("unreachable"));
    expect(await archiveRecording("m1")).toEqual({ available: false });
  });
});
