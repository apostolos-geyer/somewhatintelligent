import { createFileRoute } from "@tanstack/react-router";
import { MyRequests } from "@/components/sections/assets/MyRequests";

/**
 * "My Requests" (P4.A) — the budtender's own physical-print request status view,
 * a real route under the portal shell. The `fulfilment_status` notification
 * deep-links HERE (the bell carries `refType: "physical_request"`). It renders the
 * shared `<MyRequests>` component (the same status list + the proof-of-display
 * "confirm the display is up" control) so the standalone route and the assets-layer
 * tab never drift.
 */
export const Route = createFileRoute("/_portal/requests")({
  component: MyRequestsPage,
});

function MyRequestsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 md:py-10">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">My requests</h1>
        <p className="text-sm text-muted-foreground">
          Physical-print requests you’ve placed, and where each one stands.
        </p>
      </header>
      <MyRequests />
    </div>
  );
}
