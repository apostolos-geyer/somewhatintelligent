import { describe, expect, test } from "vitest";
import type { Env, ServiceName } from "../src/manifest";
import { provision, type Exec, type SecretsIO } from "../src/run";

/** In-memory IO double so provision() never touches the real repo. */
function fakeIo(seed: Partial<Record<Env, Record<string, string>>> = {}) {
  const stores: Record<Env, Record<string, string>> = {
    local: { ...seed.local },
    staging: { ...seed.staging },
    production: { ...seed.production },
  };
  const devVars: Partial<Record<ServiceName, Record<string, string>>> = {};
  const pubkeys: Array<{ kid: string; spki: string }> = [];
  const io: SecretsIO = {
    loadStore: (env) => ({ ...stores[env] }),
    saveStore: (env, values) => {
      stores[env] = { ...values };
    },
    writeDevVarsSecrets: (service, updates) => {
      devVars[service] = { ...devVars[service], ...updates };
      return `workers/${service}/.dev.vars`;
    },
    syncAttestationPublicKey: (kid, spki) => {
      pubkeys.push({ kid, spki });
    },
  };
  return { io, stores, devVars, pubkeys };
}

/** Records wrangler invocations instead of running them. */
function recordingExec() {
  const calls: Array<{ args: string[]; stdin: string }> = [];
  const exec: Exec = async (args, stdin) => {
    calls.push({ args, stdin });
    return { code: 0, stderr: "" };
  };
  return { exec, calls };
}

describe("provision — local", () => {
  test("writes .dev.vars secrets and never invokes wrangler", async () => {
    const { io, devVars } = fakeIo();
    const { exec, calls } = recordingExec();
    const res = await provision("local", {}, exec, io);

    expect(calls).toHaveLength(0);
    expect(devVars.guestlist?.BETTER_AUTH_SECRET).toBeTruthy();
    expect(devVars.bouncer?.BNC_ATT_PRIV).toBeTruthy();
    // bouncer + identity share the one dev attestation key
    expect(devVars.identity?.BNC_ATT_PRIV).toBe(devVars.bouncer?.BNC_ATT_PRIV);
    expect(res.missingRequired).toHaveLength(0);
  });
});

describe("provision — staging", () => {
  test("generates the auth secret, persists it, and pushes to prefixed workers", async () => {
    const { io, stores } = fakeIo();
    const { exec, calls } = recordingExec();
    const res = await provision("staging", {}, exec, io);

    expect(res.generated).toContain("BETTER_AUTH_SECRET");
    expect(stores.staging.BETTER_AUTH_SECRET).toBeTruthy();

    const authPush = calls.find((c) => c.args.includes("BETTER_AUTH_SECRET"));
    expect(authPush?.args).toEqual([
      "secret",
      "put",
      "BETTER_AUTH_SECRET",
      "--name",
      "si-guestlist-staging",
    ]);
    // attestation pushed too, using the dev key, to the staging bouncer
    expect(
      calls.some((c) => c.args.includes("BNC_ATT_PRIV") && c.args.includes("si-bouncer-staging")),
    ).toBe(true);
  });

  test("is idempotent — a second run regenerates nothing and reuses the stored value", async () => {
    const { io, stores } = fakeIo();
    const { exec } = recordingExec();
    await provision("staging", {}, exec, io);
    const first = stores.staging.BETTER_AUTH_SECRET;

    const second = await provision("staging", {}, exec, io);
    expect(second.generated).toHaveLength(0);
    expect(stores.staging.BETTER_AUTH_SECRET).toBe(first);
  });
});

describe("provision — production", () => {
  test("generates auth + ed25519 and syncs the production attestation pubkey", async () => {
    const { io, stores, pubkeys } = fakeIo();
    const { exec } = recordingExec();
    const res = await provision("production", {}, exec, io);

    expect(res.generated.sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "BNC_ATT_PRIV",
      "VAULT_KEK_V1",
      "VAULT_STATE_HMAC",
    ]);
    expect(stores.production.BNC_ATT_PRIV).toContain("BEGIN PRIVATE KEY");
    expect(pubkeys.some((p) => p.kid === "production")).toBe(true);
    expect(res.pubkeySynced?.kid).toBe("production");
  });
});

describe("provision — guards", () => {
  test("dry-run applies nothing, generates nothing, calls no wrangler", async () => {
    const { io, stores } = fakeIo();
    const { exec, calls } = recordingExec();
    const res = await provision("staging", { dryRun: true }, exec, io);

    expect(res.applied).toHaveLength(0);
    expect(res.generated).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(Object.keys(stores.staging)).toHaveLength(0);
  });

  test("noGenerate leaves required secrets missing and blocks apply", async () => {
    const { io } = fakeIo();
    const { exec, calls } = recordingExec();
    const res = await provision("staging", { noGenerate: true }, exec, io);

    expect(res.missingRequired.some((e) => e.secret === "BETTER_AUTH_SECRET")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("--worker filter only touches that service", async () => {
    const { io } = fakeIo({ staging: { RESEND_API_KEY: "re_test" } });
    const { exec, calls } = recordingExec();
    await provision("staging", { filter: { service: "promoter" } }, exec, io);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "secret",
      "put",
      "RESEND_API_KEY",
      "--name",
      "si-promoter-staging",
    ]);
    expect(calls[0]?.stdin).toBe("re_test");
  });
});
