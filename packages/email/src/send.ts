import type React from "react";
import { render } from "@react-email/render";
import { Resend } from "resend";

/**
 * Minimal shape of Cloudflare Email Service's `send_email` Workers binding.
 * (Email Service — the transactional product — not the older Email Routing
 * `send_email` binding, which only accepts a raw MIME `EmailMessage` and is
 * limited to verified destination addresses.) On a paid plan + an onboarded
 * domain, `.send()` delivers to any recipient and returns a message id.
 */
export interface CfEmailBinding {
  send(message: {
    to: string | string[];
    from: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  }): Promise<{ messageId: string }>;
}

/** Which transport actually delivers the mail. Switchable per environment. */
export type EmailProvider =
  | { kind: "resend"; apiKey?: string }
  | { kind: "cloudflare"; binding: CfEmailBinding };

/** Provider-agnostic result. `id` is the provider's message id (or null). */
export interface EmailResult {
  id: string | null;
  error: { message: string } | null;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string | string[];
  idempotencyKey?: string;
  provider: EmailProvider;
}

export interface SendEmailTemplateOptions<
  P extends Record<string, unknown> = Record<string, never>,
> {
  Template: React.FC<P>;
  values: P;
  subject: string;
  to: string | string[];
  from?: string;
  replyTo?: string | string[];
  idempotencyKey?: string;
  provider: EmailProvider;
}

const DEFAULT_FROM = "test@resend.dev";

/**
 * Single dispatch point. Both transports take pre-rendered HTML so the
 * react-email render happens once and the providers stay interchangeable.
 */
async function deliver(opts: {
  provider: EmailProvider;
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  replyTo?: string | string[];
  idempotencyKey?: string;
}): Promise<EmailResult> {
  if (opts.provider.kind === "cloudflare") {
    // Cloudflare Email Service throws on failure; normalize to EmailResult.
    try {
      const { messageId } = await opts.provider.binding.send({
        to: opts.to,
        from: opts.from,
        subject: opts.subject,
        html: opts.html,
        replyTo: Array.isArray(opts.replyTo) ? opts.replyTo[0] : opts.replyTo,
      });
      return { id: messageId, error: null };
    } catch (e) {
      return { id: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }

  // Resend transport. No key → no-op (e.g. unconfigured local dev).
  const apiKey = opts.provider.apiKey;
  if (!apiKey) {
    console.debug("[email] no Resend apiKey; skipping send", opts.subject, opts.to);
    return { id: null, error: null };
  }
  const res = await new Resend(apiKey).emails.send(
    {
      html: opts.html,
      to: opts.to,
      subject: opts.subject,
      from: opts.from,
      replyTo: opts.replyTo,
    },
    opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
  );
  return { id: res.data?.id ?? null, error: res.error ? { message: res.error.message } : null };
}

export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  return deliver({
    provider: opts.provider,
    to: opts.to,
    from: opts.from ?? DEFAULT_FROM,
    subject: opts.subject,
    html: opts.html,
    replyTo: opts.replyTo,
    idempotencyKey: opts.idempotencyKey,
  });
}

export async function sendEmailTemplate<P extends Record<string, unknown> = Record<string, never>>(
  opts: SendEmailTemplateOptions<P>,
): Promise<EmailResult> {
  const element = await opts.Template(opts.values);
  const html = await render(element);
  return deliver({
    provider: opts.provider,
    to: opts.to,
    from: opts.from ?? DEFAULT_FROM,
    subject: opts.subject,
    html,
    replyTo: opts.replyTo,
    idempotencyKey: opts.idempotencyKey,
  });
}
