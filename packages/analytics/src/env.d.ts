declare module "cloudflare:workers" {
  export const env: Record<string, string | undefined>;
}
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
