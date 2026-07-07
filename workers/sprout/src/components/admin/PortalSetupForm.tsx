import { useEffect, useRef, useState } from "react";
import { type } from "arktype";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Switch } from "@greenroom/ui/components/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Spinner } from "@greenroom/ui/components/spinner";
import { cn } from "@greenroom/ui/lib/utils";
import { SECTION_KEYS, SECTION_META, type SectionKey } from "@/lib/sections";
import {
  compactTheme,
  resolveEnabledSections,
  resolveFixedMode,
  themeToStyleVars,
  type BrandTheme,
  type SectionToggle,
} from "@/lib/brand";
import type { ThemeMode } from "@/lib/theme-tokens";
import {
  publishTheme,
  updatePortalConfig,
  updateThemeDraft,
  type AdminPortalConfigView,
  type AdminThemeView,
} from "@/lib/brand.functions";
import { ThemeControls } from "@/components/admin/ThemeControls";
import { SortableList } from "@/components/admin/SortableList";
import { HeroSlidesManager } from "@/components/admin/HeroSlidesManager";

/**
 * The Brand-Admin portal setup — ONE screen, TWO save paths mirroring the two
 * storage paths:
 *
 *  1. PORTAL CONTENT (live-edit): name/tagline/feedLabel ride one schema-
 *     validated `useAppForm`; the section toggles ride list state. One "Save"
 *     writes them together via `updatePortalConfig` and they're public
 *     immediately (the hero-slides manager below is the third live-edit write
 *     path, `hero_slides`).
 *  2. THEME (draft → publish): the full token workbench edits plain
 *     `BrandTheme` state through the registry-driven `<ThemeControls>` next to
 *     a scoped sticky mini-preview. "Save draft" persists privately
 *     (`updateThemeDraft`); "Publish theme" saves then flips draft → live
 *     (`publishTheme`), so a publish can never push a stale draft.
 */

const contentSchema = type({
  name: "string >= 1",
  tagline: "string <= 200",
  feedLabel: "string <= 80",
});

type ContentValues = typeof contentSchema.infer;

function toContentValues(content: AdminPortalConfigView): ContentValues {
  return {
    name: content.name,
    tagline: content.tagline,
    feedLabel: content.feedLabel,
  };
}

/** Seed the section editor list from the stored toggles, defaulting a fresh org
 * to all six canonical sections enabled in canonical order. */
function toSectionList(toggles: SectionToggle[]): SectionToggle[] {
  if (toggles.length === 0) {
    return SECTION_KEYS.map((key, i) => ({ key, enabled: true, order: i }));
  }
  const byKey = new Map(toggles.map((t) => [t.key, t]));
  const known = [...toggles].sort((a, b) => a.order - b.order);
  const missing = SECTION_KEYS.filter((k) => !byKey.has(k)).map(
    (key): SectionToggle => ({ key, enabled: false, order: known.length }),
  );
  return [...known, ...missing].map((t, i) => ({ ...t, order: i }));
}

/** Small segmented two-option toggle (KISS — no Select dependency). */
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
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
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

export function PortalSetupForm({
  theme: themeView,
  content,
  onSaved,
}: {
  theme: AdminThemeView;
  content: AdminPortalConfigView;
  onSaved?: () => void;
}) {
  // ── Path 1: portal content (live-edit) ─────────────────────────────────────
  const [sections, setSections] = useState<SectionToggle[]>(() => toSectionList(content.sections));
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const [sectionsDirty, setSectionsDirty] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentNotice, setContentNotice] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: toContentValues(content),
    // onBlur drives inline field errors; onSubmit re-validates so a bad payload
    // (e.g. empty name) aborts the save before it reaches the server.
    validators: { onBlur: contentSchema, onSubmit: contentSchema },
    onSubmit: async ({ value }) => {
      setContentError(null);
      setContentNotice(null);
      try {
        await updatePortalConfig({
          data: {
            name: value.name.trim(),
            tagline: value.tagline,
            feedLabel: value.feedLabel,
            sections: sectionsRef.current.map((s, i) => ({
              key: s.key,
              enabled: s.enabled,
              order: i,
            })),
          },
        });
        setSectionsDirty(false);
        form.reset(value);
        setContentNotice("Saved — changes are live.");
        onSaved?.();
      } catch (err) {
        setContentError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  async function saveContent() {
    setContentBusy(true);
    try {
      await form.handleSubmit();
    } finally {
      setContentBusy(false);
    }
  }

  function toggleSection(key: SectionKey) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s)));
    setSectionsDirty(true);
  }

  // ── Path 2: theme (draft → publish) ────────────────────────────────────────
  const [theme, setTheme] = useState<BrandTheme>(() => themeView.draftTheme);
  // Which palette the colour controls + preview show. Ignored when fixed (the
  // single palette is stored in `light`); fixed previews use `fixedMode`.
  const [editMode, setEditMode] = useState<ThemeMode>("light");
  const [themeDirty, setThemeDirty] = useState(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [themeBusy, setThemeBusy] = useState<"save" | "publish" | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeNotice, setThemeNotice] = useState<string | null>(null);

  const updateTheme = (next: BrandTheme) => {
    setTheme(next);
    setThemeDirty(true);
  };

  async function saveTheme(publish: boolean) {
    setThemeBusy(publish ? "publish" : "save");
    setThemeError(null);
    setThemeNotice(null);
    try {
      // Send only the buckets actually set — never explicit `undefined`,
      // which seroval preserves and the server validator rejects.
      await updateThemeDraft({ data: { theme: compactTheme(themeRef.current) } });
      setThemeDirty(false);
      if (publish) {
        await publishTheme();
        setThemeNotice("Published — your theme is now live.");
      } else {
        setThemeNotice("Draft saved.");
      }
      onSaved?.();
    } catch (err) {
      setThemeError(err instanceof Error ? err.message : String(err));
    } finally {
      setThemeBusy(null);
    }
  }

  // Re-seed from the server snapshot when the loader refetches (`onSaved` →
  // router.invalidate, fired by our own saves AND by siblings like the
  // hero-slides manager), WITHOUT clobbering an in-progress edit: a dirty
  // surface keeps the user's unsaved value; a clean one adopts the fresh data.
  // Dirty flags are read through refs so this fires only on new props, not on
  // every keystroke.
  const themeDirtyRef = useRef(themeDirty);
  themeDirtyRef.current = themeDirty;
  const sectionsDirtyRef = useRef(sectionsDirty);
  sectionsDirtyRef.current = sectionsDirty;
  const formDirtyRef = useRef(form.state.isDirty);
  formDirtyRef.current = form.state.isDirty;
  useEffect(() => {
    if (!themeDirtyRef.current) setTheme(themeView.draftTheme);
  }, [themeView]);
  useEffect(() => {
    if (!sectionsDirtyRef.current) setSections(toSectionList(content.sections));
    if (!formDirtyRef.current) form.reset(toContentValues(content));
  }, [content, form]);

  const fixed = resolveFixedMode(theme);
  const isFixed = fixed !== null;
  // Colour controls edit the `light` slot when fixed (the single palette);
  // otherwise the chosen editMode. The preview mirrors that appearance.
  const colorMode: ThemeMode = isFixed ? "light" : editMode;
  const previewMode: ThemeMode = fixed ?? editMode;
  const enabledPreview = resolveEnabledSections(sections);
  const themeIsLive = themeView.state === "live";

  return (
    <div className="flex flex-col gap-section">
      {/* ── Portal content: live-edit ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle>Portal content</CardTitle>
              <CardDescription>
                Name, tagline, feed label, and which sections show. Saves are live immediately.
              </CardDescription>
            </div>
            <Badge variant="soft">Live edit</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          {contentError && (
            <p
              role="alert"
              className="rounded-sm bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {contentError}
            </p>
          )}
          {contentNotice && (
            <p className="rounded-sm bg-success-bg px-3 py-2 text-sm text-growth-700">
              {contentNotice}
            </p>
          )}
          <div className="flex flex-col gap-4">
            <form.AppField name="name">
              {(field) => <field.TextField label="Portal name" placeholder="Acme Cannabis" />}
            </form.AppField>
            <form.AppField name="tagline">
              {(field) => <field.TextField label="Tagline" placeholder="Grow with us." />}
            </form.AppField>
            <form.AppField name="feedLabel">
              {(field) => (
                <field.TextField
                  label="Feed label"
                  description="Renames the media-feed section. Defaults to “Enter the Grow”."
                  placeholder="Enter the Grow"
                />
              )}
            </form.AppField>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <h3 className="font-medium">Sections</h3>
              <p className="text-sm text-muted-foreground">
                Enable, disable, and reorder the six portal sections.
              </p>
            </div>
            <SortableList
              items={sections}
              getKey={(s) => s.key}
              getLabel={(s) => SECTION_META[s.key].title}
              onReorder={(next) => {
                setSections(next.map((s, i) => ({ ...s, order: i })));
                setSectionsDirty(true);
              }}
              renderItem={(s) => {
                const meta = SECTION_META[s.key];
                return (
                  <div className="flex items-center gap-3">
                    <Switch
                      id={`section-${s.key}`}
                      checked={s.enabled}
                      onCheckedChange={() => toggleSection(s.key)}
                      aria-label={`Enable ${meta.title}`}
                    />
                    <Badge variant="sprout-glass">{meta.num}</Badge>
                    <div className="min-w-0">
                      <label
                        htmlFor={`section-${s.key}`}
                        className={cn(
                          "font-medium",
                          !s.enabled && "text-muted-foreground line-through",
                        )}
                      >
                        {meta.title}
                      </label>
                      <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                  </div>
                );
              }}
            />
          </div>

          {/* `form.state` reads are NOT reactive during render — typing only
              re-renders the field, not this component — so the dirty indicator
              and Save gate subscribe via <form.Subscribe>. */}
          <form.Subscribe selector={(s) => s.isDirty}>
            {(formDirty) => {
              const contentDirty = sectionsDirty || formDirty;
              return (
                <div className="flex items-center gap-3 border-t border-border pt-4">
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-sm",
                      contentDirty ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        contentDirty ? "bg-pistil" : "bg-growth",
                      )}
                    />
                    {contentDirty ? "Unsaved changes" : "All changes saved"}
                  </span>
                  <Button
                    type="button"
                    variant="strong"
                    className="ml-auto"
                    disabled={contentBusy || !contentDirty}
                    onClick={() => void saveContent()}
                  >
                    {contentBusy && <Spinner size="xs" />}
                    Save content
                  </Button>
                </div>
              );
            }}
          </form.Subscribe>
        </CardContent>
      </Card>

      {/* ── Hero slides: their own live-edit path (hero_slides CRUD) ─────────── */}
      <HeroSlidesManager onChanged={onSaved} />

      {/* ── Theme: draft → publish workbench ──────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="flex flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-7rem)] lg:self-start">
          <CardHeader className="border-b pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Appearance &amp; theme</CardTitle>
              <Badge variant={themeIsLive ? "sprout" : "sprout-glass"}>
                {themeIsLive ? "Live" : "Draft"}
              </Badge>
            </div>
            <CardDescription>
              Adaptive keeps a light + dark palette and the portal’s mode toggle; Fixed pins one
              look for every visitor. Edits stay in a private draft until you publish.
            </CardDescription>
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">Mode policy</span>
                <Segmented
                  ariaLabel="Theme mode policy"
                  value={isFixed ? "fixed" : "adaptive"}
                  options={[
                    { value: "adaptive", label: "Adaptive" },
                    { value: "fixed", label: "Fixed" },
                  ]}
                  onChange={(p) =>
                    updateTheme({
                      ...theme,
                      modePolicy: p === "fixed" ? "fixed" : undefined,
                      fixedMode: p === "fixed" ? (theme.fixedMode ?? "dark") : undefined,
                    })
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">
                  {isFixed ? "Fixed appearance" : "Editing palette"}
                </span>
                <Segmented
                  ariaLabel={isFixed ? "Fixed appearance" : "Editing palette"}
                  value={isFixed ? fixed : editMode}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  onChange={(m) =>
                    isFixed ? updateTheme({ ...theme, fixedMode: m }) : setEditMode(m)
                  }
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ThemeControls theme={theme} onChange={updateTheme} mode={colorMode} />
          </CardContent>
        </Card>

        {/* Scoped mini-preview — applies the draft tokens to real portal chrome via
            inline CSS vars (data-theme makes the dark base show for un-overridden
            tokens). The full interactive preview is demo mode. */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div
            data-theme={previewMode === "dark" ? "dark" : undefined}
            style={themeToStyleVars(theme, previewMode) as React.CSSProperties}
            className="overflow-hidden rounded-md border border-border bg-background text-foreground"
          >
            <div className="border-b border-border bg-card px-4 py-3">
              <form.Subscribe selector={(s) => s.values.name}>
                {(name) => (
                  <span className="font-display text-lg font-bold text-primary">
                    {name.trim() || "Your Portal"}
                  </span>
                )}
              </form.Subscribe>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <form.Subscribe selector={(s) => s.values.tagline}>
                {(tagline) => (
                  <p className="font-body text-sm text-muted-foreground">
                    {tagline.trim() || "Your tagline appears here."}
                  </p>
                )}
              </form.Subscribe>
              <Button type="button" variant="strong" className="w-fit">
                Enter Portal
              </Button>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="sprout">Primary</Badge>
                <Badge variant="growth">Success</Badge>
                <Badge variant="stigma">Danger</Badge>
                <Badge variant="pistil">Warning</Badge>
                <Badge variant="haze">Info</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {enabledPreview.map((key) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-sm border border-border bg-card p-2 text-xs"
                  >
                    <Badge variant="sprout-glass">{SECTION_META[key].num}</Badge>
                    <span className="truncate font-medium">{SECTION_META[key].title}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            Live draft preview ({previewMode}). Not yet published.
          </p>

          {/* Theme action bar — draft→publish is the THEME's lifecycle only. */}
          <div className="mt-3 rounded-md border border-border bg-surface/90 px-4 py-3">
            {themeError && (
              <p
                role="alert"
                className="mb-2 rounded-sm bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {themeError}
              </p>
            )}
            {themeNotice && (
              <p className="mb-2 rounded-sm bg-success-bg px-3 py-2 text-sm text-growth-700">
                {themeNotice}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "flex items-center gap-1.5 text-sm",
                  themeDirty ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn("size-2 rounded-full", themeDirty ? "bg-pistil" : "bg-growth")}
                />
                {themeDirty ? "Unsaved draft" : "Draft saved"}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    window.location.href = "/?demo=1";
                  }}
                >
                  Live demo →
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={themeBusy !== null || !themeDirty}
                  onClick={() => void saveTheme(false)}
                >
                  {themeBusy === "save" && <Spinner size="xs" />}
                  Save draft
                </Button>
                <Button
                  type="button"
                  variant="strong"
                  size="sm"
                  disabled={themeBusy !== null}
                  onClick={() => void saveTheme(true)}
                >
                  {themeBusy === "publish" && <Spinner size="xs" />}
                  Publish theme
                </Button>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              <strong className="font-medium text-foreground">Save draft</strong> keeps theme edits
              private. <strong className="font-medium text-foreground">Publish</strong> makes them
              what every visitor sees.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
