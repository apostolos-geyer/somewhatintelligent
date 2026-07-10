// Aux worker stub for the ROADIE service binding during tests.
// Must be JS — vitest-pool-workers cannot bundle TS for aux workers.
// Matches workers/roadie/src/index.ts Roadie surface; every method returns
// `{ ok: false, error: "stub_not_implemented" }` so the avatar tests can
// prove the blob adapter was invoked (clean RpcErr) without a real roadie.
// Must extend WorkerEntrypoint: a plain class is not RPC-dispatchable as a
// named entrypoint — every call dies as an opaque "internal error".
import { WorkerEntrypoint } from "cloudflare:workers";

const stub = async () => ({ ok: false, error: "stub_not_implemented" });

export class Roadie extends WorkerEntrypoint {
  async registerUpload() {
    return stub();
  }
  async signPart() {
    return stub();
  }
  async recordPart() {
    return stub();
  }
  async getMultipartStatus() {
    return stub();
  }
  async finalize() {
    return stub();
  }
  async abandon() {
    return stub();
  }
  async put() {
    return stub();
  }
  async getReadUrl() {
    return stub();
  }
  async getReference() {
    return stub();
  }
  async addReference() {
    return stub();
  }
  async removeReference() {
    return stub();
  }
  async adminUsage() {
    return stub();
  }
  async adminListBlobs() {
    return stub();
  }
  async adminForceDelete() {
    return stub();
  }
  async adminTriggerTask() {
    return stub();
  }
}

export default {
  async fetch() {
    return new Response(null, { status: 404 });
  },
};
