import { GraduationCap, Layers, PlayCircle, Sparkles, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FeaturedCarousel } from "@/components/hub/FeaturedCarousel";

/**
 * Hub — "Featured Content". Platform-curated highlights (PK decks, quizzes,
 * sessions, posts) across brands. No editorial-pick model is wired yet, so the
 * section presents as honestly Coming-soon (`FeaturedCarousel` → `ComingSoon`):
 * nothing fake by default, the sample carousel only behind an explicit preview.
 * Wiring it later = swap `SAMPLE_CONTENT` for a `getFeaturedContent` read.
 */
interface SampleContent {
  kind: string;
  icon: LucideIcon;
  title: string;
}

const SAMPLE_CONTENT: SampleContent[] = [
  { kind: "PK Deck", icon: Layers, title: "Know the Craft — Spring lineup" },
  { kind: "Quiz", icon: GraduationCap, title: "Terpenes 101 — earn your badge" },
  { kind: "Live Session", icon: PlayCircle, title: "Inside the Grow — week 6" },
  { kind: "Drop", icon: Sparkles, title: "New this Friday — small-batch rosin" },
  { kind: "From the Feed", icon: Newspaper, title: "Behind the cure — a photo story" },
];

export function FeaturedContent() {
  return (
    <FeaturedCarousel
      icon={Sparkles}
      title="Featured Content"
      subtitle="Hand-picked decks, quizzes, and sessions from across the platform."
      blurb="A monthly highlight reel of decks, quizzes and sessions — curated for the whole community."
    >
      {SAMPLE_CONTENT.map((c) => (
        <ContentCard key={c.title} content={c} />
      ))}
    </FeaturedCarousel>
  );
}

function ContentCard({ content }: { content: SampleContent }) {
  const Icon = content.icon;
  return (
    <article
      role="listitem"
      className="flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      {/* Placeholder thumbnail — a soft brand-tinted gradient + the type glyph. */}
      <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
        <Icon className="size-8 text-primary/70" aria-hidden />
      </div>
      <div className="space-y-1 p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {content.kind}
        </span>
        <p className="line-clamp-2 text-sm font-medium leading-snug">{content.title}</p>
      </div>
    </article>
  );
}
