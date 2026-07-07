// Ambient d.ts wiring for cloudflare:test; import-style cannot pull in a
// global decl file.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../worker-configuration.d.ts" />

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}

declare global {
  // eslint-disable-next-line no-var
  var __guestlistImpl: ((req: Request) => Promise<Response> | Response) | undefined;
  // eslint-disable-next-line no-var
  var __wwwImpl: ((req: Request) => Promise<Response> | Response) | undefined;
}

export {};
