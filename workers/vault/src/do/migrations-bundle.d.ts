// Types for drizzle-kit's generated DO-migrations bundle
// (migrations/migrations.js — journal + .sql files imported as text via the
// wrangler Text rule / vite sql-as-text plugin).
declare module "*/migrations/migrations" {
  interface MigrationsBundle {
    journal: {
      entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
    };
    migrations: Record<string, string>;
  }
  const bundle: MigrationsBundle;
  export default bundle;
}
