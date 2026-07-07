import type { BrandRuntime } from "@/lib/brand";

/**
 * The runtime brand wordmark. The Sprout `Logo` (build-time @greenroom/config
 * brand) is correct for Hub/Admin chrome but WRONG for a brand portal — so the
 * portal shell uses <BrandLogo> exclusively. P1.B renders the org's uploaded logo
 * (roadie R2 url via getReadUrl); the skeleton renders the brand name tinted with
 * the org's --color-primary, which is enough to prove the per-brand skin.
 */
export function BrandLogo({
  brand,
  className,
}: {
  brand: BrandRuntime | null;
  className?: string;
}) {
  const base = "font-display font-bold";
  if (!brand) {
    return <span className={`${base} text-lg ${className ?? ""}`}>Sprout</span>;
  }
  return <span className={`${base} text-xl text-primary ${className ?? ""}`}>{brand.name}</span>;
}
