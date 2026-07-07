import type { Meta, StoryObj } from "@storybook/react";
import { darkColors, accentColors } from "../src/tokens/colors";

function Swatch({
  name,
  cssVar,
  description,
  hex,
}: {
  name: string;
  cssVar: string;
  description: string;
  hex: string;
}) {
  return (
    <div className="overflow-hidden rounded-sm border-2 border-border">
      <div className="h-16 border-b border-border" style={{ background: `var(${cssVar})` }} />
      <div className="bg-surface-raised p-3">
        <div className="text-xs font-semibold">{name}</div>
        <div className="type-mono-label text-text-tertiary">{description}</div>
        <div className="type-mono-label text-text-tertiary">{hex}</div>
      </div>
    </div>
  );
}

function ColorTokensPage() {
  return (
    <div className="max-w-4xl space-y-12 p-8">
      <div>
        <h2 className="mb-2 font-heading text-2xl">Palette — Sprout</h2>
        <p className="text-sm text-muted-foreground">
          Light-first. Rooted in nature. Warm cream paper, forest-green ink, sprout-green +
          terracotta stigma accents.
        </p>
      </div>

      {/* Neutrals */}
      <section className="space-y-4">
        <h3 className="type-section-label text-text-secondary">Neutrals</h3>
        <p className="font-mono text-xs text-text-tertiary">
          Forest canvas (dark mode) shown below · Light = cream paper, the brand's primary identity
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-4">
          <Swatch
            name="Background"
            cssVar="--color-bg"
            description="Forest canvas"
            hex={darkColors.bg.hex}
          />
          <Swatch
            name="Surface"
            cssVar="--color-surface"
            description="Forest shelf"
            hex={darkColors.surface.hex}
          />
          <Swatch
            name="Raised"
            cssVar="--color-surface-raised"
            description="Raised forest"
            hex={darkColors.surfaceRaised.hex}
          />
          <Swatch
            name="Sunken"
            cssVar="--color-surface-sunken"
            description="Forest well"
            hex={darkColors.surfaceSunken.hex}
          />
          <Swatch
            name="Border"
            cssVar="--color-border"
            description="Forest line"
            hex={darkColors.border.hex}
          />
          <Swatch
            name="Border Strong"
            cssVar="--color-border-strong"
            description="Deeper forest"
            hex={darkColors.borderStrong.hex}
          />
          <Swatch
            name="Text"
            cssVar="--color-text"
            description="Cream text"
            hex={darkColors.text.hex}
          />
          <Swatch
            name="Secondary"
            cssVar="--color-text-secondary"
            description="Sage descriptions"
            hex={darkColors.textSecondary.hex}
          />
        </div>
      </section>

      {/* Accents */}
      <section className="space-y-4">
        <h3 className="type-section-label text-text-secondary">Accents — Sprout</h3>
        <div className="grid grid-cols-5 gap-3">
          <div className="overflow-hidden rounded-sm border-2 border-border">
            <div
              className="h-16 border-b border-border"
              style={{ background: "var(--color-sprout)" }}
            />
            <div className="bg-surface-raised p-3">
              <div className="text-xs font-semibold">Sprout</div>
              <div className="type-mono-label text-text-tertiary">Primary · Brand green</div>
              <div className="type-mono-label text-text-tertiary">
                {accentColors.sprout.dark.hex}
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-sm border-2 border-border">
            <div
              className="h-16 border-b border-border"
              style={{ background: "var(--color-haze)" }}
            />
            <div className="bg-surface-raised p-3">
              <div className="text-xs font-semibold">Haze</div>
              <div className="type-mono-label text-text-tertiary">Info · Purple haze</div>
              <div className="type-mono-label text-text-tertiary">{accentColors.haze.dark.hex}</div>
            </div>
          </div>
          <div className="overflow-hidden rounded-sm border-2 border-border">
            <div
              className="h-16 border-b border-border"
              style={{ background: "var(--color-growth)" }}
            />
            <div className="bg-surface-raised p-3">
              <div className="text-xs font-semibold">Growth</div>
              <div className="type-mono-label text-text-tertiary">Success · Growth green</div>
              <div className="type-mono-label text-text-tertiary">
                {accentColors.growth.dark.hex}
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-sm border-2 border-border">
            <div
              className="h-16 border-b border-border"
              style={{ background: "var(--color-pistil)" }}
            />
            <div className="bg-surface-raised p-3">
              <div className="text-xs font-semibold">Pistil</div>
              <div className="type-mono-label text-text-tertiary">Warning · Amber</div>
              <div className="type-mono-label text-text-tertiary">
                {accentColors.pistil.dark.hex}
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-sm border-2 border-border">
            <div
              className="h-16 border-b border-border"
              style={{ background: "var(--color-stigma)" }}
            />
            <div className="bg-surface-raised p-3">
              <div className="text-xs font-semibold">Stigma</div>
              <div className="type-mono-label text-text-tertiary">Destructive · Terracotta</div>
              <div className="type-mono-label text-text-tertiary">
                {accentColors.stigma.dark.hex}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Glass Effects */}
      <section className="space-y-4">
        <h3 className="type-section-label text-text-secondary">Glass Effects</h3>
        <div className="relative h-48 overflow-hidden rounded-sm bg-gradient-to-br from-sprout/30 to-stigma/30 p-6">
          <div className="absolute inset-6 rounded-sm glass p-6">
            <p className="font-semibold">Glassmorphism</p>
            <p className="text-sm text-muted-foreground">glass-bg + glass-border + glass-blur</p>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta: Meta = {
  title: "Design/Color Tokens",
  tags: ["autodocs"],
};
export default meta;

export const AllColors: StoryObj = {
  render: () => <ColorTokensPage />,
  parameters: { layout: "fullscreen" },
};
