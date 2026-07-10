import { Link } from "@tanstack/react-router";
import { Button } from "@si/ui/components/button";

function Frame({ code, title, blurb }: { code: string; title: string; blurb: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="font-display text-primary text-7xl font-extralight tracking-tighter">
        {code}
      </div>
      <h1 className="text-foreground text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-md font-mono text-sm">{blurb}</p>
      <Button nativeButton={false} render={<Link to="/" />}>
        Back to the shop
      </Button>
    </div>
  );
}

export function AppNotFound() {
  return (
    <Frame code="404" title="Not found" blurb="That page wandered off. The rack's this way." />
  );
}

export function AppError({ error }: { error: Error }) {
  return (
    <Frame
      code="500"
      title="Something broke"
      blurb={error?.message ? `${error.message}` : "An unexpected error occurred."}
    />
  );
}
