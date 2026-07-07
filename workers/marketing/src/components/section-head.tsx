/**
 * Section header pattern — eyebrow + display heading + optional lede.
 * Mirrors the prototype's `.sec-head` / `.eyebrow` / `.display` / `.lede`.
 *
 *  - eyebrow  → font-body, uppercase, tracked; growth on light, bright lime on dark
 *  - title    → font-display (Zerove caps the text on its own)
 *  - lede     → font-editorial (IBM Plex Serif); muted secondary text
 *
 * `center` centres the block (default). `onDark` recolours for dark forest
 * sections — pair it with a `data-theme="dark"` section root so any semantic
 * tokens flip too, though these classes are self-sufficient either way.
 */
export function SectionHead({
  kicker,
  title,
  lede,
  center = true,
  onDark = false,
}: {
  kicker: string;
  title: string;
  lede?: string;
  center?: boolean;
  onDark?: boolean;
}) {
  return (
    <div className={`max-w-[640px] ${center ? "mx-auto text-center" : ""}`}>
      <span
        className={`inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] ${
          onDark ? "text-sprout-green" : "text-growth"
        }`}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {kicker}
      </span>
      <h2
        className={`mt-3.5 font-display text-3xl leading-[1.05] tracking-[0.01em] sm:text-4xl lg:text-5xl ${
          onDark ? "text-cream" : "text-text"
        }`}
      >
        {title}
      </h2>
      {lede ? (
        <p
          className={`mt-4 text-pretty font-editorial text-lg leading-relaxed sm:text-xl ${
            onDark ? "text-forest-300" : "text-text-secondary"
          }`}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}
