// The real Sprout lockup (seedling + wordmark) — same brand mark as the
// marketing site banner. Identity's auth surfaces are light, so use the green
// colourway (Vite resolves the PNG import to a URL string via vite/client).
import lockup from "@greenroom/design/assets/logos/sprout-lockup-green.png";

// Per-app product name. Each app in the workspace declares its own —
// see `workers/identity/src/app-brand.ts` (this is the identity app's value).
import { APP_PRODUCT_NAME } from "#/app-brand";

export function GuestlistBrand({ className, size = 64 }: { className?: string; size?: number }) {
  const subtitleSize = Math.max(7, size * 0.15);
  return (
    <div className={className}>
      <div className="flex flex-col items-center" style={{ viewTransitionName: "guestlist-brand" }}>
        <img src={lockup} alt="Sprout" style={{ height: size, width: "auto" }} />
        <span
          className="mt-1 font-mono uppercase tracking-[0.25em] text-text-tertiary"
          style={{ fontSize: `${subtitleSize}px` }}
        >
          {APP_PRODUCT_NAME} platform
        </span>
      </div>
    </div>
  );
}
