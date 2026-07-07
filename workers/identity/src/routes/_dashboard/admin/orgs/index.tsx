import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@si/ui/components/button";
import { listOrgsForAdmin } from "@/lib/org-admin.functions";
import { relativeTime } from "@/lib/relative-time";

export const Route = createFileRoute("/_dashboard/admin/orgs/")({
  loader: () => listOrgsForAdmin(),
  head: () => ({ meta: [{ title: "Organizations — Admin" }] }),
  component: OrgsPage,
});

function OrgsPage() {
  const { orgs } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section flex items-baseline justify-between">
        <div>
          <h1 className="type-page-title">Organizations</h1>
          <p className="mt-1 text-sm text-text-secondary">
            The customer brands provisioned on this platform. Each is its own tenant of the identity
            apparatus.
          </p>
        </div>
        <Link to="/admin/orgs/new">
          <Button size="sm">+ New organization</Button>
        </Link>
      </div>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Slug
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Name
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Members
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Created
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Owner
              </th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-tertiary">
                  No organizations yet.{" "}
                  <Link to="/admin/orgs/new" className="text-primary hover:underline">
                    Onboard your first brand →
                  </Link>
                </td>
              </tr>
            )}
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link
                    to="/admin/orgs/$id"
                    params={{ id: o.id }}
                    className="font-mono text-xs hover:text-primary"
                  >
                    {o.slug}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium">{o.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-text-tertiary">{o.memberCount}</td>
                <td className="px-4 py-3 font-mono text-xs text-text-tertiary">
                  {relativeTime(o.createdAt)}
                </td>
                <td className="px-4 py-3 text-sm">
                  {o.ownerName ?? <span className="text-text-tertiary">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
