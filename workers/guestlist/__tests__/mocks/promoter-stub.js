// Aux worker stub for the PROMOTER service binding during tests.
// Must be JS — vitest-pool-workers cannot bundle TS for aux workers.
// Matches workers/promoter/src/index.ts Promoter surface; return shape
// mirrors what the real worker returns when RESEND_API_KEY is unset.
import { WorkerEntrypoint } from "cloudflare:workers";

export class Promoter extends WorkerEntrypoint {
  async sendVerification() {
    return { data: null, error: null };
  }
  async sendResetPassword() {
    return { data: null, error: null };
  }
  async sendEmailChange() {
    return { data: null, error: null };
  }
  async sendDeleteAccount() {
    return { data: null, error: null };
  }
}

export default {
  async fetch() {
    return new Response(null, { status: 404 });
  },
};
