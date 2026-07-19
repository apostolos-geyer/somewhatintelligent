import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";

// Overview — the Access → shell → page smoke test. Renders the resolved actor
// from router context (seeded by the root `beforeLoad` via `whoAmI`), proving
// the whole pipeline end to end.
export const Route = createFileRoute("/")({
  component: Overview,
});

const PLANNED = [
  { label: "Objects", blurb: "Products, variants, and stock." },
  { label: "Texts", blurb: "Long-form writing releases." },
  { label: "Software", blurb: "Software catalog records." },
  { label: "Pages", blurb: "Typed fixed-page documents." },
  { label: "Orders", blurb: "Fulfillment and payment state." },
  { label: "Media", blurb: "Storage-neutral media views." },
  { label: "Settings", blurb: "Console configuration." },
] as const;

function Overview() {
  const { actor } = Route.useRouteContext();
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-foreground text-3xl font-light tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Signed in as <span className="text-foreground font-medium">{actor?.email}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLANNED.map((m) => (
          <Card key={m.label} variant="soft" className="gap-2">
            <CardHeader>
              <CardTitle className="text-base font-medium">{m.label}</CardTitle>
              <CardDescription>{m.blurb}</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="text-muted-foreground/70 font-mono text-[10px] uppercase tracking-wider">
                coming soon
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
