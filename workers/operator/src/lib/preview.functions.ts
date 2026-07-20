/**
 * Preview server function (RFC-0001 D14, exec-plan 0004 T23). Actor-required:
 * takes the operator's CURRENT editor draft state (what the form shows, not a
 * re-fetch), validates the envelope shape, and returns the signed preview
 * `{ payloadJson, signature, expiresAt }` for the browser to POST into the Site
 * preview iframe. The signing secret never leaves the server; the browser only
 * ever receives the mint. Page documents are passed through and authoritatively
 * re-validated by Site at the preview boundary (INV-PAGE-1).
 */
import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { requireOperatorActor } from "@/lib/server-fn-actor";
import { signPreviewPayload, type PreviewPayload } from "@/lib/preview";

const textPayload = type({
  kind: "'text'",
  title: "string <= 200",
  slug: "1 <= string <= 64",
  deck: "string | null",
  tags: "string[]",
  bodyMarkdown: "string",
  version: "1 <= string <= 32",
  publishedAt: "number",
});

const softwarePayload = type({
  kind: "'software'",
  name: "string <= 200",
  slug: "1 <= string <= 64",
  deck: "string <= 400",
  whatItIsMarkdown: "string",
  destinationUrl: "string <= 2048",
  actionLabel: "string <= 80",
  updatedAt: "number",
});

const pagePayload = type({
  kind: "'page'",
  key: "'home' | 'shop' | 'writing' | 'software' | 'about'",
  document: "object",
});

const previewInput = textPayload.or(softwarePayload).or(pagePayload);

export const signPreview = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof previewInput.infer) => previewInput.assert(data))
  .handler(({ data }) => {
    const secret = env.PREVIEW_SIGNING_SECRET;
    if (!secret) {
      throw new Response("preview signing secret not configured", { status: 500 });
    }
    return signPreviewPayload(secret, data as PreviewPayload);
  });
