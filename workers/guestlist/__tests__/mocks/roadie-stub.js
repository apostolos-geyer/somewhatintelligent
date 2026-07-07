// Aux worker stub for the ROADIE service binding during tests.
// Must be JS — vitest-pool-workers cannot bundle TS for aux workers.
// Matches workers/roadie/src/index.ts Roadie surface; every method returns
// `{ ok: false, error: "stub_not_implemented" }` so any test that
// accidentally exercises an avatar code path fails loudly with a useful
// message rather than miniflare-level breakage. Avatar routes themselves
// are not covered by the current test suite — when they are, this stub
// should be replaced with per-test mocks via vi.spyOn / fakes.
const stub = async () => ({ ok: false, error: "stub_not_implemented" });

export class Roadie {
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
