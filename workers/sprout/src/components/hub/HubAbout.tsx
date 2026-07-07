import { ArrowUpRight, HelpCircle, Sprout } from "lucide-react";
import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { HubSectionHeader } from "@/components/hub/HubSectionHeader";

/**
 * Hub footer — one "About & Help" section pairing the platform's own framing (the
 * Hub is the ONE Sprout-branded surface) with an FAQ link-out. `FAQ_URL` is the
 * single place to point the link-out at the operator's help centre.
 */
const FAQ_URL = "https://sproutportal.ca/faq";

export function HubAbout() {
  return (
    <section className="space-y-4">
      <HubSectionHeader icon={Sprout} title="About & Help" />
      <div className="grid items-stretch gap-grid sm:grid-cols-2">
        {/* About */}
        <Card variant="soft" className="space-y-2 p-5">
          <h3 className="font-display text-lg font-bold tracking-tight">About Sprout</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sprout is the platform behind every brand portal you visit — one place to learn the
            brands you sell, earn toward a professional-development fund, and stay in the loop.
            Everything lives inside the platform; nothing leaves it.
          </p>
          <p className="text-sm font-medium">Learn Green, Earn Green.</p>
        </Card>

        {/* FAQ link-out — flex-row is explicit because Card defaults to flex-col. */}
        <a
          href={FAQ_URL}
          target="_blank"
          rel="noreferrer"
          className="group/faq block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sprout"
          aria-label="Frequently asked questions (opens in a new tab)"
        >
          <Card
            variant="soft"
            className={cn(
              "flex h-full flex-row items-center gap-4 p-5",
              interactiveMaterials.brutal,
            )}
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary">
              <HelpCircle className="size-6" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-display text-lg font-bold tracking-tight">Questions?</p>
              <p className="text-sm text-muted-foreground">
                Browse the FAQ for help with portals, points, and your account.
              </p>
            </div>
            <ArrowUpRight
              className="size-5 shrink-0 text-muted-foreground transition-colors group-hover/faq:text-primary"
              aria-hidden
            />
          </Card>
        </a>
      </div>
    </section>
  );
}
