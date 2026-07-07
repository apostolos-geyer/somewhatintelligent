/**
 * O-8 — `organization-invitation` template + dispatch coverage.
 *
 * These are plain unit tests (vite-plus/test). Promoter's worker class
 * extends `WorkerEntrypoint` from `cloudflare:workers`, which is a
 * runtime-only module; instantiating the class outside workerd is not
 * meaningful. Until promoter gains a `cloudflare:test` harness (deferred —
 * promoter has no D1/R2/state and would need a separate aux-worker setup
 * just to exercise RPC dispatch), we cover the new code path by:
 *
 *   1. Rendering the template via `@react-email/render` and asserting the
 *      output carries the load-bearing fields (invite URL, inviter, org).
 *   2. Calling `sendEmailTemplate` (the wrapper promoter delegates to) with a
 *      keyless resend provider to verify the no-op branch returns the shape
 *      promoter's `case "organization-invitation":` arm expects, which is
 *      then projected into `{ success: true, id: null }` by the caller.
 */
import { createElement } from "react";
import { describe, expect, test } from "vite-plus/test";
import { platformConfig, platformDeployConfig } from "@si/config";
import { GuestlistOrgInvitationEmail, render, sendEmailTemplate } from "@si/email";

const baseDomain = platformDeployConfig.baseDomain;

const sampleProps = {
  name: "Pat",
  inviterName: "Alex Operator",
  inviterEmail: `alex@test.${baseDomain}`,
  organizationName: "Acme Records",
  role: "admin",
  inviteUrl: `https://identity.${baseDomain}/orgs/accept/inv_01ABCDEF`,
} as const;

describe("GuestlistOrgInvitationEmail", () => {
  test("renders with all load-bearing fields", async () => {
    const html = await render(createElement(GuestlistOrgInvitationEmail, sampleProps));

    // Invitee greeting uses the name when present.
    expect(html).toContain("Pat");
    // Inviter identity is shown.
    expect(html).toContain("Alex Operator");
    expect(html).toContain(sampleProps.inviterEmail);
    // Org name + role appear together in the body.
    expect(html).toContain("Acme Records");
    expect(html).toContain("admin");
    // CTA button + raw URL both reference the invite URL.
    expect(html).toContain(sampleProps.inviteUrl);
    expect(html).toContain("Accept invitation");
  });

  test("falls back to a nameless greeting when `name` is omitted", async () => {
    const html = await render(
      createElement(GuestlistOrgInvitationEmail, { ...sampleProps, name: undefined }),
    );
    expect(html).toContain("You&#x27;re invited");
    expect(html).not.toContain("Pat");
  });
});

describe("sendEmailTemplate with organization-invitation", () => {
  test("returns success-shaped no-op when RESEND_API_KEY is unset", async () => {
    // This is the exact branch promoter's `case "organization-invitation":`
    // arm awaits when the resend transport has no key (local dev / test env).
    // The wrapper short-circuits and returns `{ id: null, error: null }`,
    // which promoter's `send` projects into `{ success: true, id: null }`.
    const res = await sendEmailTemplate({
      Template: GuestlistOrgInvitationEmail,
      values: sampleProps,
      to: `invitee@test.${baseDomain}`,
      from: `noreply@test.${baseDomain}`,
      subject: `Join ${sampleProps.organizationName} on ${platformConfig.brand.name}`,
      provider: { kind: "resend", apiKey: undefined },
    });
    expect(res).toEqual({ id: null, error: null });
  });
});
