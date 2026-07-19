import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { whoAmI } from "@/lib/actor.functions";

// Settings = a read-only operational panel (RFC-0001 D1). Actor identity, the
// environment, the Access enforcement mode, and the service bindings in play —
// no mutations, no live probing.
export const Route = createFileRoute("/settings/")({
  loader: () => whoAmI(),
  component: Settings,
});

const ENVIRONMENT = (import.meta.env.ENVIRONMENT as string | undefined) ?? "development";
const IS_DEV = ENVIRONMENT === "development";

function Settings() {
  const { actor } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-foreground text-3xl font-light tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Operational readout for this Operator deployment.
        </p>
      </div>

      <Panel title="Operator">
        <Row label="Subject">
          <span className="font-mono text-xs">{actor?.sub ?? "—"}</span>
        </Row>
        <Row label="Email">
          <span className="font-mono text-xs">{actor?.email ?? "—"}</span>
        </Row>
      </Panel>

      <Panel title="Environment">
        <Row label="ENVIRONMENT">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">
            {ENVIRONMENT}
          </Badge>
        </Row>
        <Row label="Access enforcement">
          {IS_DEV ? (
            <span className="text-muted-foreground text-xs">
              Dev actor (fixed <span className="font-mono">DEV_OPERATOR</span>) — no JWT required
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              Verified Cloudflare Access JWT (issuer + audience enforced, fails closed)
            </span>
          )}
        </Row>
      </Panel>

      <Panel title="Service bindings">
        <Row label="STORE">
          <span className="font-mono text-xs">StoreOperator · props.callerApp=operator</span>
        </Row>
        <Row label="PUBLISHER">
          <span className="font-mono text-xs">PublisherOperator · props.callerApp=operator</span>
        </Row>
        <p className="text-muted-foreground/70 mt-2 font-mono text-[10px]">
          Operator binds only these two mutation entrypoints — no D1/R2/Stripe/Guestlist binding
          (INV-OP-2).
        </p>
      </Panel>

      <Panel title="Runbooks">
        <ul className="grid gap-1.5 font-mono text-xs">
          <li className="text-muted-foreground">docs/ops/env-vars.md — env var contract table</li>
          <li className="text-muted-foreground">
            bun run access:setup — provision the Access application (staging/production)
          </li>
          <li className="text-muted-foreground">
            docs/runbooks/roadie-r2-provisioning.md — media rendering setup
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="soft" className="mb-6 p-5">
      <h2 className="text-foreground mb-3 font-semibold">{title}</h2>
      <div className="grid gap-3">{children}</div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      {children}
    </div>
  );
}
