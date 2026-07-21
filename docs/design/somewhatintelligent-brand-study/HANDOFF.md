# somewhatintelligent design implementation handoff

## Branch and objective

- Branch: `codex/somewhatintelligent-design-system`
- Base: `main` at `77c9af9`
- Objective: turn the existing platform into the accepted somewhatintelligent publishing/shop identity without replacing its auth, store, Roadie/R2, Stripe, or routing spine.
- First commit: design-system foundation plus the complete research/mockup package.

## Accepted decisions

- The brand is **somewhatintelligent**; the author is **Apostoli**.
- Apostoli's authorship can appear in provenance and About copy. Do not use his face or generate a likeness.
- Apostoli is not for hire. Do not write availability, commission, consulting, or employment CTAs.
- The public unit of change is a **semantic versioned release** such as `1.0.0`.
- Physical goods, software, and writing share one release grammar while retaining honest domain state: stock, access, revision, and publication.
- Visual language: garment black, cold proof paper, steel rules, photorealistic evidence, compressed display type, editorial serif, mono state data, and one scarce signal-pink correction.
- No defense-contractor mythology, ontology language, militarized styling, tactical UI, fake HUDs, gradients, glassmorphism, or generic rounded SaaS cards.

## Design-system foundation in this branch

| Role                              | Choice                     | Contract                                                               |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| Display                           | Barlow Condensed           | `font-display`, `font-heading`                                         |
| Body and editorial                | Source Serif 4             | `font-body`, `font-editorial`, `font-editorial-display`, `font-accent` |
| Evidence/state                    | Iosevka                    | `font-mono`                                                            |
| Primary action/private correction | Signal pink                | semantic `primary` and `ring`                                          |
| Main materials                    | cold paper / garment black | semantic background, card, surface, border, inverse                    |
| Mark                              | FRIEND asterisk            | shared browser + OG-safe logo geometry                                 |
| Shape                             | nearly square              | radius tokens 0–6px; `full` remains for truly circular controls        |

Font binaries and their OFL licenses are vendored under `packages/design/src/fonts/` so Workers and OG builds do not rely on a third-party font CDN.

## Existing platform boundaries to preserve

- `workers/identity`: auth/account/passkeys/sessions/2FA/API keys. Do not fork auth persistence into an app.
- `workers/store`: catalog, variants, stock, local cart, checkout, orders, fulfillment, and admin.
- Store D1: product/order/event data.
- Roadie/R2: uploaded bytes; apps retain references only.
- Guestlist: user/session authority and shared billing-customer seam.
- Bouncer: `/account` and `/shop` mounted ingress. Preserve mount rewrite and server-function bases.

See [`04-operational-system.md`](./04-operational-system.md) for the proposed Publishing D1 model. It is not implemented by the foundation commit.

## Next-session implementation order

1. Verify the foundation commit and render Storybook/design proof for both themes.
2. Reskin the real store shell, home, product, cart, and checkout routes using mockups `01`, `02`, `06`, `08`, and `11` as composition references—not literal screenshots.
3. Reskin catalog/order admin using mockup `12`, preserving all current mutations and upload behavior.
4. Reskin sign-in and account surfaces using `09` and `10`.
5. Add the About/writing/software public information architecture.
6. Specify and implement Publishing D1 revisions only after the existing surfaces are visually coherent.
7. Wire subscriptions only against real Stripe state; never ship fictional subscription status.

## Implementation rules

- UI-kit components use semantic tokens only. Brand-named utilities stay out of `packages/ui` except the allowed logo brand surface.
- New literal colors belong in `packages/design/src/tokens/brand.ts`, followed by codegen and contrast audit.
- Generated CSS is never hand-edited.
- Prefer rules, spacing, type, and state hierarchy over decorative containers.
- One screen gets at most one expressive leak (pink annotation, editorial image, or typographic rupture). Operational controls stay plain.
- Maintain visible keyboard focus, reduced-motion behavior, and mobile layouts.
- Use actual route data and existing server functions; do not hard-code mockup content into production components.

The store source still contains legacy `ochre`/`verdigris` utilities and one
root-theme hex literal. Remove those while reskinning the store; do not
allowlist them. Run brand lint against `src/` directories, not compiled
`dist/` output.

## Verification

```sh
(cd packages/design && bun run codegen)
(cd packages/design && bun run audit:contrast)
(cd packages/design && bun run typecheck)
(cd packages/design && bun run test)
(cd packages/design && bun run brand-lint ../../workers/identity/src)
(cd packages/design && bun run brand-lint ../ui/src/components --strict-semantic)
bun run check
```

At this foundation commit, the scoped design/UI/identity checks pass. The
workspace-wide `bun run check` still reports formatting-only baseline failures
in `inbox/alchemy.run.ts` and the six worker `CHANGELOG.md` files; none are part
of the design change. Do not fold those unrelated rewrites into a visual route
commit without deciding to clean the repository baseline explicitly.

For browser proof, load the repo's `interactive-test` and `agent-browser` skills, boot the local stack, sign in with a seeded user, and capture the real `/shop`, `/shop/cart`, `/shop/admin`, `/account/sign-in`, and `/account` surfaces at desktop and mobile widths.

## Asset map

- `mockups/`: accepted visual/composition references.
- `reference-images/`: generated world/material studies.
- `source-assets/`: original FRIEND artwork and current-shop screenshot used as inputs.
- `03-generation-ledger.md`: generated-image provenance and constraints.

Generated images are reference material, not production UI captures. Text inside them may be approximate; production copy must come from route/domain state.
