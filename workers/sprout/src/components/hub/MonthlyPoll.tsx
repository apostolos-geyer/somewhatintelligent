import { BarChart3, Clock } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { HubSectionHeader } from "@/components/hub/HubSectionHeader";
import { ComingSoon } from "@/components/hub/ComingSoon";

/**
 * Hub — "Poll of the Month". A community pulse-check across the platform. No
 * polling model is wired yet, so the section presents as honestly Coming-soon
 * (`ComingSoon`): nothing fake by default; the sample bars only appear behind an
 * explicit preview, captioned as sample data. Wiring it later = swap `SAMPLE_*`
 * for a `getMonthlyPoll` read + a `submitVote` mutation.
 */
const SAMPLE_QUESTION = "What's your store's top-selling category this month?";
const SAMPLE_OPTIONS = [
  { label: "Flower", pct: 42 },
  { label: "Pre-rolls", pct: 23 },
  { label: "Extracts & hash", pct: 21 },
  { label: "Edibles", pct: 14 },
];

export function MonthlyPoll() {
  return (
    <section className="space-y-4">
      <HubSectionHeader
        icon={BarChart3}
        title="Poll of the Month"
        subtitle="One quick question for the whole community. New poll every month."
        badge={
          <Badge variant="warn" className="gap-1">
            <Clock className="size-3" aria-hidden />
            Coming soon
          </Badge>
        }
      />
      <ComingSoon
        label="the monthly poll"
        blurb="One question for the whole community, with live results — every month."
      >
        <PollSample />
      </ComingSoon>
    </section>
  );
}

/** The illustrative poll (revealed behind the preview, never shown by default). */
function PollSample() {
  return (
    <div>
      <p className="font-display text-base font-bold">{SAMPLE_QUESTION}</p>
      <ul className="mt-3 space-y-2.5" aria-hidden>
        {SAMPLE_OPTIONS.map((o) => (
          <li key={o.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{o.label}</span>
              <span className="tabular-nums text-muted-foreground">{o.pct}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary/40" style={{ width: `${o.pct}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
