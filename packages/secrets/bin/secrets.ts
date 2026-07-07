#!/usr/bin/env bun
/**
 * Secrets provisioner CLI.
 *
 *   bun packages/secrets/bin/secrets.ts <local|staging|production> [flags]
 *   (or, from the repo root: `bun run secrets <env> [flags]`)
 *
 * Flags:
 *   --status            Show the resolved plan only (read-only; no generate/apply).
 *   --dry-run           Plan + report what would happen; no writes, no wrangler.
 *   --worker <name>     Limit to one service (e.g. guestlist, bouncer).
 *   --only <SECRET>     Limit to one secret (e.g. BETTER_AUTH_SECRET).
 *   --no-generate       Don't generate missing generated secrets.
 *   -h, --help          This help.
 *
 * Remote envs use `wrangler secret put --name <worker>`; set CLOUDFLARE_ACCOUNT_ID
 * (the CLI passes it through). Local merges into each service's .dev.vars.
 *
 * See docs/runbooks/SECRETS.md for the full runbook.
 */
import { spawn } from "node:child_process";
import { buildPlan, type PlanEntry } from "../src/resolve";
import { loadStore } from "../src/io";
import { ENVS, type Env, type ServiceName } from "../src/manifest";
import { provision, type Exec } from "../src/run";

const HELP = (): void => {
  process.stdout.write(
    [
      "Usage: bun run secrets <local|staging|production> [flags]",
      "",
      "  --status         show the resolved plan only (read-only)",
      "  --dry-run        plan + report; no writes, no wrangler",
      "  --worker <name>  limit to one service",
      "  --only <SECRET>  limit to one secret",
      "  --no-generate    don't generate missing generated secrets",
      "  -h, --help       this help",
      "",
      "See docs/runbooks/SECRETS.md",
      "",
    ].join("\n"),
  );
};

interface Args {
  env?: Env;
  status: boolean;
  dryRun: boolean;
  noGenerate: boolean;
  worker?: ServiceName;
  only?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { status: false, dryRun: false, noGenerate: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--status":
        args.status = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--no-generate":
        args.noGenerate = true;
        break;
      case "--worker":
        args.worker = argv[++i] as ServiceName;
        break;
      case "--only":
        args.only = argv[++i];
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        if (a !== undefined && !a.startsWith("-")) args.env = a as Env;
    }
  }
  return args;
}

const STATUS_ICON: Record<PlanEntry["status"], string> = {
  ready: "✓",
  "to-generate": "✺",
  missing: "✗",
};

function printPlan(plan: PlanEntry[]): void {
  if (plan.length === 0) {
    process.stdout.write("  (nothing targeted)\n");
    return;
  }
  const width = Math.max(...plan.map((e) => e.secret.length));
  for (const e of plan) {
    const tag =
      e.status === "ready"
        ? `ready (${e.source})`
        : e.status === "to-generate"
          ? "will generate"
          : e.required
            ? "MISSING — required"
            : "missing — optional, skipped";
    process.stdout.write(
      `  ${STATUS_ICON[e.status]} ${e.secret.padEnd(width)}  ${e.service.padEnd(10)} → ${e.target}   [${tag}]\n`,
    );
  }
}

function makeExec(): Exec {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  return (cliArgs, stdin) =>
    new Promise((resolveExec) => {
      const child = spawn("bunx", ["wrangler", ...cliArgs], {
        env: {
          ...process.env,
          ...(accountId !== undefined ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}),
        },
        stdio: ["pipe", "inherit", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.stdin.write(stdin);
      child.stdin.end();
      child.on("close", (code) => resolveExec({ code: code ?? 1, stderr }));
    });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.env === undefined) {
    HELP();
    process.exit(args.help ? 0 : 1);
  }
  if (!ENVS.includes(args.env)) {
    process.stderr.write(`Unknown env "${args.env}". Use: ${ENVS.join(", ")}\n`);
    process.exit(1);
  }
  const filter = { service: args.worker, secret: args.only };

  if (
    args.env !== "local" &&
    process.env.CLOUDFLARE_ACCOUNT_ID === undefined &&
    !args.dryRun &&
    !args.status
  ) {
    process.stderr.write(
      "warning: CLOUDFLARE_ACCOUNT_ID is not set — wrangler may target the wrong account.\n",
    );
  }

  process.stdout.write(`\n@si/secrets — env: ${args.env}\n\n`);

  if (args.status) {
    printPlan(buildPlan(args.env, loadStore(args.env), filter));
    return;
  }

  const result = await provision(
    args.env,
    { dryRun: args.dryRun, noGenerate: args.noGenerate, filter },
    makeExec(),
  );

  printPlan(result.plan);
  process.stdout.write("\n");

  if (result.generated.length > 0) {
    process.stdout.write(`generated + stored: ${result.generated.join(", ")}\n`);
  }
  if (result.pubkeySynced !== undefined) {
    process.stdout.write(
      `synced attestation pubkey (kid=${result.pubkeySynced.kid}) into bouncer-attestation.ts — review + commit it.\n`,
    );
  }
  if (result.missingRequired.length > 0) {
    process.stderr.write(`\nBLOCKED — required secrets missing (fill .secrets/${args.env}.env):\n`);
    for (const e of result.missingRequired) process.stderr.write(`  - ${e.secret}\n`);
    process.exit(1);
  }
  if (result.skippedOptional.length > 0) {
    const names = [...new Set(result.skippedOptional.map((e) => e.secret))];
    process.stdout.write(`skipped optional (no value provided): ${names.join(", ")}\n`);
  }

  if (args.dryRun) {
    process.stdout.write("\n(dry-run — no changes applied)\n");
  } else {
    process.stdout.write(`\napplied ${result.applied.length} secret(s) to ${args.env}.\n`);
  }
}

void main();
