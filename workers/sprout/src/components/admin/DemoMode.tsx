import { useCallback, useEffect, useState } from "react";
import { Paintbrush, X } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Spinner } from "@greenroom/ui/components/spinner";
import { cn } from "@greenroom/ui/lib/utils";
import { brandThemeToCss, compactTheme, resolveFixedMode, type BrandTheme } from "@/lib/brand";
import type { ThemeMode } from "@/lib/theme-tokens";
import {
  getAdminTheme,
  publishTheme,
  updateThemeDraft,
  type AdminThemeView,
} from "@/lib/brand.functions";
import { ThemeControls } from "@/components/admin/ThemeControls";

/**
 * Demo mode — the FAB live preview on the REAL portal (docs/sprout/11 §6b).
 *
 * Activated by `?demo=1` for a brand admin. It renders the real portal untouched
 * underneath and lets the admin tweak the full theme from a floating panel, with
 * every edit reflected LIVE in their own browser ONLY:
 *  - the persisted live skin (SSR `BrandStyle`) is disabled (media="not all") so
 *    the preview equals what publishing would produce: Sprout base + this draft;
 *  - a `<style id="sprout-demo-theme">` injects `brandThemeToCss(localTheme)` and
 *    updates on every keystroke;
 *  - `fixed` policy pins `data-theme` so the right Sprout base fills gaps.
 *
 * NOTHING is written until the admin clicks Save (`updateThemeDraft`) or Publish
 * (save + `publishTheme`). In-progress work is mirrored to localStorage so a
 * refresh keeps it. Other users/sessions are never affected.
 *
 * The panel chrome re-asserts a fixed neutral palette on its own subtree so it
 * stays legible even while the brand theme being edited is extreme.
 */

const DEMO_STYLE_ID = "sprout-demo-theme";

/** A fixed, theme-independent chrome so the editor stays usable under any draft. */
const CHROME_VARS: Record<string, string> = {
  "--color-bg": "#0b0b0c",
  "--color-surface": "#161618",
  "--color-surface-raised": "#1c1c1f",
  "--color-surface-sunken": "#0b0b0c",
  "--color-text": "#f4f4f5",
  "--color-text-secondary": "#b9b9bd",
  "--color-text-tertiary": "#8a8a90",
  "--color-border": "#2a2a2e",
  "--color-border-strong": "#3a3a40",
  "--color-sprout": "#7bc24e",
  "--color-sprout-hover": "#8fd267",
  "--color-primary": "#7bc24e",
};

function lsKey(orgId: string): string {
  return `sprout-demo-theme:${orgId}`;
}

export function DemoMode({ isAdmin, orgId }: { isAdmin: boolean; orgId: string }) {
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(true);
  const [config, setConfig] = useState<AdminThemeView | null>(null);
  const [theme, setTheme] = useState<BrandTheme>({});
  const [editMode, setEditMode] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Detect ?demo=1 on mount (client-only; demo mode is entered by a full nav).
  useEffect(() => {
    if (typeof window === "undefined") return;
    setActive(new URLSearchParams(window.location.search).get("demo") === "1");
  }, []);

  // Load the draft once when activated; prefer in-progress localStorage work.
  useEffect(() => {
    if (!active || !isAdmin) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const cfg = await getAdminTheme();
        if (cancelled) return;
        setConfig(cfg);
        let next: BrandTheme = cfg.draftTheme;
        const saved = window.localStorage.getItem(lsKey(orgId));
        if (saved) {
          try {
            next = JSON.parse(saved) as BrandTheme;
          } catch {
            /* ignore corrupt local draft */
          }
        }
        setTheme(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, isAdmin, orgId]);

  // Inject the live preview style + disable the SSR brand skin while active, so
  // the preview equals Sprout base + this draft. Restore everything on exit.
  useEffect(() => {
    if (!active || !isAdmin || typeof document === "undefined") return;
    const head = document.head;

    // Disable the persisted live skin (BrandStyle renders <style data-brand>).
    const liveStyles = Array.from(document.querySelectorAll<HTMLStyleElement>("style[data-brand]"));
    const prevMedia = liveStyles.map((el) => el.getAttribute("media"));
    liveStyles.forEach((el) => el.setAttribute("media", "not all"));

    let styleEl = document.getElementById(DEMO_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = DEMO_STYLE_ID;
      head.appendChild(styleEl);
    }
    styleEl.textContent = brandThemeToCss(theme);

    // Pin appearance for fixed policy; otherwise mirror the editor's mode toggle.
    const root = document.documentElement;
    const prevTheme = root.getAttribute("data-theme");
    const fixed = resolveFixedMode(theme);
    root.setAttribute("data-theme", fixed ?? editMode);

    return () => {
      // Remove the preview override and re-enable the persisted live skin so the
      // portal returns to its published appearance the instant demo mode exits.
      styleEl?.remove();
      liveStyles.forEach((el, i) => {
        const m = prevMedia[i];
        if (m === null) el.removeAttribute("media");
        else el.setAttribute("media", m);
      });
      if (prevTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", prevTheme);
    };
  }, [active, isAdmin, theme, editMode]);

  // Mirror in-progress edits to localStorage so a refresh keeps the draft.
  useEffect(() => {
    if (!active || !config) return;
    window.localStorage.setItem(lsKey(orgId), JSON.stringify(theme));
  }, [active, config, orgId, theme]);

  const exit = useCallback(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("demo");
      window.history.replaceState(null, "", url.toString());
    }
    setActive(false);
  }, []);

  async function save(): Promise<boolean> {
    if (!config) return false;
    setBusy("save");
    setNotice(null);
    try {
      // Send only the buckets actually set — never explicit `undefined`,
      // which seroval preserves and the server validator rejects.
      await updateThemeDraft({ data: { theme: compactTheme(theme) } });
      window.localStorage.removeItem(lsKey(orgId));
      setNotice("Draft saved.");
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    setNotice(null);
    const ok = await save();
    if (!ok) return;
    setBusy("publish");
    try {
      await publishTheme();
      setNotice("Published — your portal is now live.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setTheme(config?.draftTheme ?? {});
    window.localStorage.removeItem(lsKey(orgId));
    setNotice("Reverted to the last saved draft.");
  }

  if (!active || !isAdmin) return null;

  const isFixed = resolveFixedMode(theme) !== null;
  const colorMode: ThemeMode = isFixed ? "light" : editMode;

  return (
    <div
      className="fixed right-4 bottom-4 z-[1000] flex flex-col items-end gap-3"
      style={CHROME_VARS as React.CSSProperties}
    >
      {open && (
        <section
          aria-label="Theme demo editor"
          className="flex max-h-[80vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-surface text-foreground shadow-soft-lg"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-3">
            <div className="flex items-center gap-2">
              <Paintbrush className="size-4 text-primary" aria-hidden />
              <span className="font-display text-sm font-bold">Demo theme</span>
            </div>
            <button
              type="button"
              aria-label="Close editor"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner size="xs" /> Loading your draft…
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    ariaLabel="Mode policy"
                    value={isFixed ? "fixed" : "adaptive"}
                    options={[
                      { value: "adaptive", label: "Adaptive" },
                      { value: "fixed", label: "Fixed" },
                    ]}
                    onChange={(p) =>
                      setTheme((t) => ({
                        ...t,
                        modePolicy: p === "fixed" ? "fixed" : undefined,
                        fixedMode: p === "fixed" ? (t.fixedMode ?? "dark") : undefined,
                      }))
                    }
                  />
                  <Segmented
                    ariaLabel={isFixed ? "Fixed appearance" : "Editing palette"}
                    value={isFixed ? (resolveFixedMode(theme) ?? "light") : editMode}
                    options={[
                      { value: "light", label: "Light" },
                      { value: "dark", label: "Dark" },
                    ]}
                    onChange={(m) =>
                      isFixed ? setTheme((t) => ({ ...t, fixedMode: m })) : setEditMode(m)
                    }
                  />
                </div>
                <ThemeControls theme={theme} onChange={setTheme} mode={colorMode} />
              </div>
            )}
          </div>

          <footer className="shrink-0 border-t border-border bg-surface-raised px-4 py-3">
            {notice && <p className="mb-2 text-xs text-muted-foreground">{notice}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="strong"
                onClick={() => void save()}
                disabled={busy !== null}
              >
                {busy === "save" && <Spinner size="xs" />}
                Save draft
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void publish()}
                disabled={busy !== null}
              >
                {busy === "publish" && <Spinner size="xs" />}
                Publish
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={busy !== null}
              >
                Reset
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={exit} className="ml-auto">
                Exit
              </Button>
            </div>
          </footer>
        </section>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open theme demo editor"
          className="flex size-12 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-soft-lg"
        >
          <Paintbrush className="size-5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Small segmented two-option toggle (local to keep the FAB self-contained). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
