import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
} from "@cloudflare/realtimekit-react";
import { RtkMeeting } from "@cloudflare/realtimekit-react-ui";

/**
 * The real RealtimeKit meeting surface (P4.C, Phase 2). Code-split and lazy-loaded
 * by `CallRoom` so the UI Kit — web components + WebRTC, strictly browser-only —
 * never enters the SSR bundle or the portal's initial chunk; it streams in on the
 * first Join only. Mounted EXCLUSIVELY with a provisioned participant `authToken`
 * (CallRoom renders the `{ available:false }` placeholder when RealtimeKit is inert
 * in local dev), so this component assumes a valid token and owns nothing else:
 * device selection + the actual join happen on `<RtkMeeting>`'s setup screen.
 */
export function RealtimeMeeting({ authToken }: { authToken: string }) {
  const [meeting, initMeeting] = useRealtimeKitClient();

  useEffect(() => {
    // Per-join init — the short-lived token scopes this participant. The provider
    // renders its `fallback` until the client finishes initialising.
    void initMeeting({ authToken });
  }, [authToken, initMeeting]);

  return (
    <RealtimeKitProvider value={meeting} fallback={<MeetingLoading />}>
      <MeetingSurface />
    </RealtimeKitProvider>
  );
}

/** Renders only once the provider has a live client (`meeting` is defined here). */
function MeetingSurface() {
  const { meeting } = useRealtimeKitMeeting();
  return (
    <div className="h-full w-full overflow-hidden rounded-lg">
      <RtkMeeting meeting={meeting} mode="fill" showSetupScreen />
    </div>
  );
}

function MeetingLoading() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-8 animate-spin" aria-hidden />
      <p className="text-sm">Connecting to the room…</p>
    </div>
  );
}
