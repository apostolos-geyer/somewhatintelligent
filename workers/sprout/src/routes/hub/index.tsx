import { createFileRoute } from "@tanstack/react-router";
import { PortalsSection } from "@/components/hub/PortalsSection";
import { FeaturedBrand } from "@/components/hub/FeaturedBrand";
import { FeaturedContent } from "@/components/hub/FeaturedContent";
import { FeaturedProducts } from "@/components/hub/FeaturedProducts";
import { LeaderboardSection } from "@/components/hub/LeaderboardSection";
import { AwardSection } from "@/components/hub/AwardSection";
import { MonthlyPoll } from "@/components/hub/MonthlyPoll";
import { HubAbout } from "@/components/hub/HubAbout";
import { CredentialCard } from "@/components/hub/CredentialCard";
import { getFeaturedBrand, listJoinableBrands, listMyPortals } from "@/lib/hub.functions";
import { getAward, getLastMonthWinner, getPlatformLeaderboard } from "@/lib/award.functions";
import { getMyCredential } from "@/lib/credentials.functions";

/**
 * Hub home (P5) — the ONE Sprout-branded surface and a GLOBAL, cross-brand
 * community space: a single scrolling page (journey-report wireframe "THE HUB"),
 * NOT a sidebar of routes. Every read is keyed off the caller's identity + the
 * union of their brand memberships, or is platform-global — never a single
 * resolved tenant. The scroll, in order:
 *
 *   1. Your Portals / Portals you can join   (the caller's brands)
 *   2. Featured Brand of the Month            (global editorial spotlight)
 *   3. Featured Content                        (carousel — curated, coming soon)
 *   4. Featured Products                       (carousel — curated, coming soon)
 *   5. Leaderboard — this month                (cross-brand, the caller's brands)
 *   6. Education Award + Last Month's Winner   (cross-brand)
 *   7. Poll of the Month                       (community — coming soon)
 *   8. About + FAQ                             (platform framing + help link-out)
 *
 * Notification SETTINGS live on `/hub/notifications` (with the feed), not here.
 */
export const Route = createFileRoute("/hub/")({
  loader: async () => {
    const [portals, joinable, featured, board, awards, winners, credential] = await Promise.all([
      listMyPortals(),
      listJoinableBrands(),
      getFeaturedBrand(),
      getPlatformLeaderboard(),
      getAward(),
      getLastMonthWinner(),
      getMyCredential(),
    ]);
    return { portals, joinable, featured, board, awards, winners, credential };
  },
  component: HubHome,
});

function HubHome() {
  const { portals, joinable, featured, board, awards, winners, credential } = Route.useLoaderData();
  return (
    <div className="flex w-full flex-col gap-section">
      <PortalsSection portals={portals} joinable={joinable} />
      <CredentialCard credential={credential} />
      <FeaturedBrand brand={featured} />
      <FeaturedContent />
      <FeaturedProducts />
      <LeaderboardSection board={board} />
      <AwardSection awards={awards} winners={winners} />
      <MonthlyPoll />
      <HubAbout />
    </div>
  );
}
