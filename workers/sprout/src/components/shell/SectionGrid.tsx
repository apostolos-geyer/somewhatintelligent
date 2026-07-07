import {
  BookOpen,
  FolderDown,
  GraduationCap,
  Images,
  Mail,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { SECTION_KEYS, SECTION_META, type SectionKey } from "@/lib/sections";
import { useLayerStack } from "./use-layer-stack";

const ICONS: Record<SectionKey, LucideIcon> = {
  assets: FolderDown,
  decks: BookOpen,
  quizzes: GraduationCap,
  feed: Images,
  chat: MessagesSquare,
  contact: Mail,
};

/**
 * The section grid. Renders the brand's ENABLED sections in the brand's configured
 * order (falling back to all six canonical sections when a brand has no toggles).
 * Each tile flips the `?section=` param via `openLayer`, mounting the matching
 * SectionLayer over the grid (which stays mounted, preserving scroll).
 */
export function SectionGrid({
  sections,
  feedLabel,
}: {
  sections?: readonly SectionKey[];
  feedLabel?: string;
}) {
  const { openLayer } = useLayerStack();
  const keys = sections && sections.length > 0 ? sections : SECTION_KEYS;
  return (
    <div role="list" className="grid grid-cols-2 gap-grid lg:grid-cols-3">
      {keys.map((key) => {
        const s = SECTION_META[key];
        const Icon = ICONS[s.key];
        const title = s.key === "feed" && feedLabel ? feedLabel : s.title;
        return (
          <button
            key={s.key}
            type="button"
            role="listitem"
            onClick={() => openLayer(s.key)}
            aria-label={`Section ${s.num}, ${title}`}
            className={cn(
              "flex flex-col items-start gap-2 rounded-sm border border-border bg-card p-4 text-left sm:p-5",
              interactiveMaterials.brutal,
            )}
          >
            <Badge variant="sprout-glass">{s.num}</Badge>
            <Icon className="size-6 text-primary" aria-hidden />
            <h3 className="font-display text-lg font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground">{s.description}</p>
          </button>
        );
      })}
    </div>
  );
}
