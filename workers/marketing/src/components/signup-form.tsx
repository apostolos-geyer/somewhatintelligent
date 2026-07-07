/**
 * Email-capture islands ported from the Sprout prototype's `.signup` /
 * `.mini-form` blocks (sections-a.jsx `SignupForm`, sections-b.jsx `MiniForm`).
 *
 * Both are self-contained, stateful React islands. On submit they POST the
 * email to the marketing `/api/early-access` endpoint (Astro server route →
 * marketing D1 `early_access`), then swap to a success state. `source` tags
 * where the signup came from (hero / final / lp / retail).
 *
 * Bespoke marketing chrome — a single email field — so they use small
 * controlled `<form>`s over native inputs styled with design-system tokens,
 * rather than `useAppForm`. Colour comes ONLY from tokens.
 */
import { useState } from "react";

import { Button } from "@greenroom/ui/components/button";

import { ArrowRight, Check, Lock } from "./icons";

type Status = "idle" | "loading" | "done" | "error";

/** POST the email to the early-access endpoint. Returns true on success. */
async function captureEmail(email: string, source: string): Promise<boolean> {
  try {
    const res = await fetch("/api/early-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), source }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ───────────────────────────── SignupForm ───────────────────────────── */

/**
 * Pill email-capture row for dark surfaces (hero + final CTA). On submit it
 * POSTs then swaps to the lime success card. `onDark` (default `true`) styles
 * it for the indica canvas; pass `onDark={false}` for the rare light placement.
 */
export function SignupForm({
  onDark = true,
  source = "hero",
}: {
  onDark?: boolean;
  source?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim().length < 3) return;
    setStatus("loading");
    setStatus((await captureEmail(email, source)) ? "done" : "error");
  }

  if (status === "done") {
    return (
      <div className="mt-[30px] max-w-[480px]">
        <div className="flex animate-pop items-center gap-3.5 rounded-lg border border-sprout-green/40 bg-sprout-green/12 px-5 py-[18px]">
          <span className="grid size-[38px] flex-none place-items-center rounded-full bg-sprout-green text-indica-green">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <strong
              className={`block font-sans text-base font-semibold leading-tight ${
                onDark ? "text-cream" : "text-text"
              }`}
            >
              You&apos;re on the list 🌱
            </strong>
            <span
              className={`font-sans text-xs ${onDark ? "text-forest-300" : "text-text-secondary"}`}
            >
              We&apos;ll email {email.includes("@") ? email : "you"} the moment early access opens.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className="mt-[30px] max-w-[480px]" onSubmit={submit}>
      <div
        className={`flex gap-2.5 rounded-full border p-[7px] pl-2 transition-colors duration-200 focus-within:border-sprout-green ${
          onDark
            ? "border-cream/16 bg-cream/[0.07] focus-within:bg-cream/10"
            : "border-border bg-surface focus-within:bg-surface"
        }`}
      >
        <input
          type="email"
          required
          placeholder="you@yourbrand.ca"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
          className={`min-w-0 flex-1 bg-transparent px-3.5 font-sans text-[15px] font-normal outline-none ${
            onDark
              ? "text-cream placeholder:text-forest-300"
              : "text-text placeholder:text-text-tertiary"
          }`}
        />
        <Button type="submit" className="flex-none" disabled={status === "loading"}>
          {status === "loading" ? "…" : "Notify me"}
          <ArrowRight size={17} />
        </Button>
      </div>
      <div
        className={`ml-1 mt-3 flex items-center gap-[7px] font-sans text-xs ${
          status === "error" ? "text-stigma" : onDark ? "text-forest-300" : "text-text-secondary"
        }`}
      >
        <Lock size={13} className={status === "error" ? "text-stigma" : "text-sprout-green"} />
        {status === "error"
          ? "Something went wrong — try again."
          : "No spam — just one email when we open the doors."}
      </div>
    </form>
  );
}

/* ────────────────────────────── MiniForm ────────────────────────────── */

/**
 * Compact email capture for the light dual-CTA cards (sections-b.jsx
 * `MiniForm`). A bordered pill input + `strong` (growth) Button; on submit it
 * POSTs then swaps to a growth check + confirmation line.
 */
export function MiniForm({
  placeholder,
  source = "dual",
}: {
  placeholder: string;
  source?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (email.trim().length < 3) return;
    setStatus("loading");
    setStatus((await captureEmail(email, source)) ? "done" : "error");
  }

  if (status === "done") {
    return (
      <div className="flex animate-pop items-center gap-[11px] font-sans text-[15px] font-semibold leading-snug text-growth-700">
        <span className="grid size-[30px] flex-none place-items-center rounded-full bg-growth-green text-white">
          <Check size={17} strokeWidth={2.5} />
        </span>
        You&apos;re on the list — we&apos;ll be in touch.
      </div>
    );
  }

  return (
    <form className="flex flex-wrap gap-2.5" onSubmit={submit}>
      <input
        type="email"
        required
        placeholder={placeholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email address"
        className="min-w-[180px] flex-1 rounded-full border-[1.5px] border-border-strong bg-surface px-[18px] py-[13px] font-sans text-[15px] font-normal text-text outline-none transition-[box-shadow,border-color] placeholder:text-text-tertiary focus:border-growth-green focus:shadow-[0_0_0_3px_var(--color-success-bg)]"
      />
      <Button type="submit" variant="strong" className="flex-none" disabled={status === "loading"}>
        {status === "loading" ? "…" : "Notify me"}
      </Button>
      {status === "error" && (
        <span className="w-full font-sans text-xs text-stigma">
          Something went wrong — try again.
        </span>
      )}
    </form>
  );
}
