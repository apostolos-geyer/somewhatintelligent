/**
 * The five committed default page documents (RFC-0001 "Fixed page document
 * contracts"). Copy is lifted verbatim from the committed Astro placeholders
 * (`workers/site/src/pages/*`), SEO from those pages' `<Base>` props and layout
 * defaults. Single source of truth for the local-dev seed (`scripts/seed.ts`)
 * and the page-document validation tests — every default validates through
 * `validatePageDocument` by construction.
 */
import type { PageDocumentByKey, PageKey } from "@si/contracts/pages";

export const DEFAULT_PAGE_DOCUMENTS: { [K in PageKey]: PageDocumentByKey[K] } = {
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
  writing: {
    schemaVersion: 1,
    key: "writing",
    seo: {
      title: "Writing — somewhatintelligent",
      description: "Writing by Apostoli, published by somewhatintelligent.",
      imageMediaId: null,
    },
    eyebrow: "TEXTS",
    title: "WRITING",
    deck: "arguments, notes, and revisions",
    emptyMessage: "Writing records will appear here.",
  },
  software: {
    schemaVersion: 1,
    key: "software",
    seo: {
      title: "Software — somewhatintelligent",
      description:
        "Software and research systems by somewhatintelligent, with explicit access boundaries.",
      imageMediaId: null,
    },
    eyebrow: "SYSTEMS",
    title: "SYSTEMS",
    deck: "Software and research systems, with explicit access boundaries.",
    emptyMessage: "No systems are published yet.",
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
};
