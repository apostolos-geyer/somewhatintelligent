import { getGuestlist } from "@/lib/guestlist";
import { listPortalMemberIds } from "@/lib/portal-members";

/**
 * userId → display name for a brand's audience (leaderboard + analytics matrix),
 * merged from two sources: org members (names embedded by the org plugin) and
 * portal members (budtenders, who have no org membership — resolved by id via
 * `getUsersByIds`). Degrades to ids on any lookup error.
 */
export async function resolveMemberNames(brandId: string): Promise<Map<string, string>> {
  const guestlist = getGuestlist();
  const map = new Map<string, string>();

  try {
    const res = await guestlist.auth.organization.getFullOrganization({
      query: { organizationId: brandId },
    });
    const members = (res.data?.members ?? []) as Array<{ user?: { id?: string; name?: string } }>;
    for (const m of members) {
      if (m.user?.id && m.user.name) map.set(m.user.id, m.user.name);
    }
  } catch {
    // org lookup unavailable — fall through to portal members.
  }

  try {
    const ids = (await listPortalMemberIds(brandId)).filter((id) => !map.has(id));
    const batches: Array<Promise<Array<{ id: string; name: string }>>> = [];
    for (let i = 0; i < ids.length; i += 100) {
      batches.push(guestlist.getUsersByIds({ ids: ids.slice(i, i + 100) }));
    }
    for (const users of await Promise.all(batches)) {
      for (const u of users) if (u.name) map.set(u.id, u.name);
    }
  } catch {
    // user-directory lookup unavailable — names just render as ids.
  }

  return map;
}
