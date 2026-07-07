import type { ComponentType } from "react";
import type { SectionKey } from "@/lib/sections";
import { AssetsSection } from "@/components/sections/assets/AssetsSection";
import { DecksSection } from "@/components/sections/decks/DecksSection";
import { QuizzesSection } from "@/components/sections/quizzes/QuizzesSection";
import { FeedSection } from "@/components/sections/feed/FeedSection";
import { ChatSection } from "@/components/sections/chat/ChatSection";
import { ContactSection } from "@/components/sections/contact/ContactSection";

/**
 * Maps each section key → its full-screen layer component. The LayerStack renders
 * `SECTION_REGISTRY[section]` inside the SectionLayer shell. Each section is
 * self-contained — it reads the active brand from router context and its deep-link
 * target from `useLayerStack().item`, so registry entries take no props. All six
 * sections are live (assets/decks/quizzes/feed/chat/contact).
 */
export const SECTION_REGISTRY: Record<SectionKey, ComponentType> = {
  assets: AssetsSection,
  decks: DecksSection,
  quizzes: QuizzesSection,
  feed: FeedSection,
  chat: ChatSection,
  contact: ContactSection,
};
