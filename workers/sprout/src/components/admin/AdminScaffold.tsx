import type { ReactNode } from "react";

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  const heading = (
    <>
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </>
  );

  if (!action) return <header className="space-y-1">{heading}</header>;

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">{heading}</div>
      {action}
    </header>
  );
}

export function AdminSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ErrorBanner({ error, role }: { error: string | null; role?: "alert" }) {
  if (!error) return null;
  return (
    <p
      role={role}
      className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {error}
    </p>
  );
}
