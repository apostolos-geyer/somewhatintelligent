/**
 * The vmf mount frame contract for redirect/navigate hrefs. Pins the
 * regression where the post-auth default target `/account` — byte-identical
 * to identity's `/account` vmf mount — was handed raw to `redirect({ href })`,
 * got input-stripped by the mount rewrite to `/`, and ping-ponged against the
 * index route's own redirect forever (sign-in hung re-calling loadSession
 * until a hard refresh).
 */
import { afterEach, describe, expect, test } from "vitest";
import { mountRewrite, toBrowserHref } from "@/lib/basepath";

function setMountMeta(mount: string) {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "si-mount");
  meta.setAttribute("content", mount);
  document.head.appendChild(meta);
}

afterEach(() => {
  for (const m of document.querySelectorAll('meta[name="si-mount"]')) m.remove();
});

describe("toBrowserHref", () => {
  test("prefixes root-relative paths with the announced mount", () => {
    setMountMeta("/account");
    expect(toBrowserHref("/account")).toBe("/account/account");
    expect(toBrowserHref("/sign-in")).toBe("/account/sign-in");
    expect(toBrowserHref("/api/auth/oauth2/authorize?client_id=x")).toBe(
      "/account/api/auth/oauth2/authorize?client_id=x",
    );
  });

  test("dev-direct (no mount meta): paths pass through unchanged", () => {
    expect(toBrowserHref("/account")).toBe("/account");
    expect(toBrowserHref("/sign-in")).toBe("/sign-in");
  });

  test("absolute URLs pass through untouched", () => {
    setMountMeta("/account");
    expect(toBrowserHref("https://apex.example/app/hub")).toBe("https://apex.example/app/hub");
  });

  test("round-trips through the router's input rewrite back to the internal path", () => {
    setMountMeta("/account");
    const rewrite = mountRewrite("/account")!;
    // "/account" is the collision case: raw, the input rewrite would strip it
    // to "/" (the loop); mount-prefixed it comes back as itself.
    for (const internal of ["/account", "/sign-in", "/account/sessions"]) {
      const url = new URL(toBrowserHref(internal), "https://host.example");
      expect(rewrite.input({ url }).pathname).toBe(internal);
    }
  });
});
