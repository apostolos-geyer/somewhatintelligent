import { instrumented, requireRequestLog } from "@si/kit/log";
import { handleVersionRequest } from "@si/kit/version";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  GuestlistDeleteConfirmationEmail,
  GuestlistEmailChangeEmail,
  GuestlistMagicLinkEmail,
  GuestlistOrgInvitationEmail,
  GuestlistResetPasswordEmail,
  GuestlistVerificationEmail,
  type EmailProvider,
  emailTo,
  sendEmailTemplate,
} from "@si/email";
import { platformConfig } from "@si/config";
import { actorId, hashEmail, validateMeta } from "./meta";
import type { PromoterEnv } from "./promoter-env";

export type Recipient = { email: string; name?: string };

export type SendResult = { success: true; id: string | null } | { success: false; error: string };

// Discriminated by `kind` so Promoter owns the templates while callers stay
// decoupled from react-email. Adding a template = new kind here + redeploy;
// caller-side change is one new union arm.
export type SendInput = {
  to: Recipient;
  from: string;
  // Optional Resend Idempotency-Key passthrough. Only meaningful for
  // callers that retry (queue worker, workflow step). For fire-and-forget
  // dispatches, omit — keying on a token/url would silently collapse
  // legitimate user-triggered resends within the 24h dedup window.
  idempotencyKey?: string;
} & (
  | { kind: "verification"; url: string }
  | { kind: "reset-password"; url: string }
  | { kind: "email-change"; url: string; newEmail: string }
  | { kind: "delete-account"; url: string }
  | { kind: "magic-link"; url: string }
  | {
      kind: "organization-invitation";
      inviterName: string;
      inviterEmail: string;
      organizationName: string;
      role: string;
      inviteUrl: string;
    }
);

// Logging is class-level via `@instrumented`. Every call to
// `send` opens a `withCanonicalLog` scope from the meta arg. The handler
// body adds template/recipient_hash/provider_message_id/duration via
// `requireRequestLog().add(...)` and explicitly sets outcome on the
// success/Resend-error/threw branches. `onError` catches uncaught
// exceptions and converts them to `{ success: false, error: ... }` so
// callers always get a typed return.
@instrumented({
  service: "promoter",
  resolveContext: ({ args }) => {
    const meta = validateMeta(args[args.length - 1]);
    return {
      requestId: meta.requestId,
      actorKind: meta.actor.kind,
      actorId: actorId(meta.actor),
      callerApp: meta.callerApp,
    };
  },
  deriveOutcome: (ret) => {
    const r = ret as SendResult;
    return r.success ? "ok" : "provider_error";
  },
  onError: (e): SendResult => ({
    success: false,
    error: e instanceof Error ? e.message : String(e),
  }),
})
export class Promoter extends WorkerEntrypoint<PromoterEnv> {
  async send(input: SendInput, _meta: unknown): Promise<SendResult> {
    const log = requireRequestLog();
    const recipientHash = await hashEmail(input.to.email);
    log.add({
      template: input.kind,
      recipient_hash: recipientHash,
      env: this.env.ENVIRONMENT,
    });

    // Transport is switchable per environment. "cloudflare" uses the Email
    // Service `send_email` binding (real domain, e.g. somewhatintelligent.ca); anything
    // else falls back to Resend. Falls back to Resend too if the CF binding
    // isn't actually present, so a misconfigured env degrades instead of throwing.
    const provider: EmailProvider =
      this.env.EMAIL_PROVIDER === "cloudflare" && this.env.EMAIL
        ? { kind: "cloudflare", binding: this.env.EMAIL }
        : { kind: "resend", apiKey: this.env.RESEND_API_KEY };
    log.add({ email_provider: provider.kind });

    const name = input.to.name ?? input.to.email;
    const common = {
      to: emailTo(input.to.email, this.env.ENVIRONMENT, provider.kind),
      from: input.from,
      idempotencyKey: input.idempotencyKey,
      provider,
    };

    const send = (() => {
      switch (input.kind) {
        case "verification":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistVerificationEmail,
            values: { name, url: input.url },
            subject: "Verify your identity",
          });
        case "reset-password":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistResetPasswordEmail,
            values: { name, url: input.url },
            subject: "Reset your password",
          });
        case "email-change":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistEmailChangeEmail,
            values: { name, oldEmail: input.to.email, newEmail: input.newEmail, url: input.url },
            subject: "Confirm email change",
          });
        case "delete-account":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistDeleteConfirmationEmail,
            values: { name, url: input.url },
            subject: "Confirm account deletion",
          });
        case "magic-link":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistMagicLinkEmail,
            values: { name, url: input.url },
            subject: "Your sign-in link",
          });
        case "organization-invitation":
          return sendEmailTemplate({
            ...common,
            Template: GuestlistOrgInvitationEmail,
            values: {
              name,
              inviterName: input.inviterName,
              inviterEmail: input.inviterEmail,
              organizationName: input.organizationName,
              role: input.role,
              inviteUrl: input.inviteUrl,
            },
            subject: `Join ${input.organizationName} on ${platformConfig.brand.name}`,
          });
      }
    })();

    const res = await send;
    if (res.error) {
      log.add({ provider_error: res.error.message });
      return { success: false, error: res.error.message };
    }
    log.add({ provider_message_id: res.id });
    return { success: true, id: res.id };
  }
}

// No public HTTP surface beyond /__version (version/commit are ship-time-
// injected vars, see @si/kit/version) — Promoter is RPC-only via service
// binding; everything else stays 404.
export default {
  async fetch(request: Request, env: PromoterEnv): Promise<Response> {
    return (
      handleVersionRequest(request, { worker: "promoter", env }) ??
      new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<PromoterEnv>;
