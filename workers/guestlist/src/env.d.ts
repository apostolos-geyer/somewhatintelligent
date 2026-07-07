// Optional secrets not yet in .dev.vars — augments generated worker-configuration.d.ts.
// Once these providers are configured, add them to .dev.vars and remove from here.
declare namespace Cloudflare {
  interface Env {
    MICROSOFT_CLIENT_ID?: string;
    MICROSOFT_CLIENT_SECRET?: string;
    FACEBOOK_CLIENT_ID?: string;
    FACEBOOK_CLIENT_SECRET?: string;
  }
}
