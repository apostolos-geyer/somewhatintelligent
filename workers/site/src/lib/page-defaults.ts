/**
 * Site-local fallback page documents (RFC-0001 D9). When `getPage(key)` returns
 * `not_found` (a page never published — INV-PUB-1 null active pointer), the
 * public route renders these defaults so the site is never blank. Copy mirrors
 * Publisher's committed seed defaults, which were themselves lifted from the
 * original committed placeholders — so an unpublished site renders identically
 * to a freshly-seeded one. Only the three keys whose routes read a document
 * through the shared views (`home`/`about`/`shop`); `writing`/`software` carry
 * their own field-level fallbacks in-route.
 */
import type { AboutDocumentV1, HomeDocumentV1, ShopDocumentV1 } from "@si/contracts";

export const DEFAULT_PAGE_DOCUMENTS: {
  home: HomeDocumentV1;
  about: AboutDocumentV1;
  shop: ShopDocumentV1;
} = {
  home: {
    schemaVersion: 1,
    key: "home",
    seo: {
      title: "somewhatintelligent — objects, systems, texts",
      description: "Objects, systems, texts, and other side effects by Apostoli.",
      imageMediaId: null,
    },
    tagline: "objects, texts, systems, & side effects",
    heroMediaId: null,
    sections: {
      objects: {
        eyebrow: "OBJECTS",
        body: "Hand made and algorithmically marketed. What better way to express your subversion than through consumption?",
        featuredProductId: null,
        actionLabel: "Shop now",
      },
      systems: {
        eyebrow: "SOFTWARE REGISTRY",
        body: "Digital solutions to problems created by digital solutions to problems. People used to live in longhouses. Now you want an MCP gateway.",
        featuredSoftwareId: null,
        actionLabel: "Explore systems",
      },
      texts: {
        eyebrow: "TEXTS",
        body: "Critical writing on technology, intimacy, and power. Or a catalog of my arrogance. Interpretation is left as an exercise to the reader.",
        featuredTextId: null,
        actionLabel: "Read texts",
      },
      about: {
        eyebrow: "ABOUT",
        body: "The mask behind the other, more abstract mask. Of course, the subject remains as obscured as ever.",
        actionLabel: "About",
      },
    },
  },
  about: {
    schemaVersion: 1,
    key: "about",
    seo: {
      title: "Apostoli — somewhatintelligent",
      description:
        "Apostoli is the publisher, writer, and operator responsible for somewhatintelligent. Not for hire.",
      imageMediaId: null,
    },
    eyebrow: "ABOUT",
    title: "APOSTOLI",
    statement:
      "Why be curious? It is an act towards intimacy—a bid for connection—with one's own existence. It is an act of epistemic humility. No act is more profoundly intimate than the struggle to understand something outside oneself.\n\nThus, I am curious. I build systems because I like knowing how things work. I like being the one who decides how things work. I make art because I like having license to comment on how they already do. Should I be entrusted with such power? No less than anyone else should be entrusted to make such a judgement.",
    primaryMediaId: null,
    secondaryMediaId: null,
    lowerContent: "Selected work — coming soon.",
  },
  shop: {
    schemaVersion: 1,
    key: "shop",
    seo: {
      title: "Objects — somewhatintelligent",
      description: "Versioned clothing and physical goods published by somewhatintelligent.",
      imageMediaId: null,
    },
    eyebrow: "OBJECTS",
    title: "OBJECTS",
    deck: "Artifacts for interface, code, and the public we build.",
    emptyMessage: "No objects are published yet.",
  },
};
