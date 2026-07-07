import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "./badge";

const meta = {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "secondary",
        "destructive",
        "outline",
        "sprout",
        "stigma",
        "growth",
        "pistil",
        "haze",
        "sprout-brutal",
        "stigma-brutal",
        "growth-brutal",
        "pistil-brutal",
        "haze-brutal",
        "sprout-glass",
        "stigma-glass",
        "growth-glass",
        "pistil-glass",
        "haze-glass",
      ],
    },
    size: {
      control: "select",
      options: ["sm", "default", "lg"],
    },
  },
  args: {
    children: "Badge",
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Glyph: Story = {
  args: { variant: "sprout", children: "Active" },
};

export const Verdigris: Story = {
  args: { variant: "growth", children: "Published" },
};

export const Slate: Story = {
  args: { variant: "haze", children: "Info" },
};

export const Ochre: Story = {
  args: { variant: "pistil", children: "Pending" },
};

export const Blood: Story = {
  args: { variant: "stigma", children: "Error" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Draft" },
};

export const Secondary: Story = {
  args: { variant: "secondary" },
};

export const Destructive: Story = {
  args: { variant: "destructive" },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      <Badge size="sm" variant="sprout">
        Small
      </Badge>
      <Badge size="default" variant="sprout">
        Default
      </Badge>
      <Badge size="lg" variant="sprout">
        Large
      </Badge>
    </div>
  ),
  parameters: { layout: "padded" },
};

/** Matches the badge row in the design system demo */
export const DesignDemoShowcase: Story = {
  name: "Design Demo Showcase",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge variant="sprout">Active</Badge>
      <Badge variant="growth">Published</Badge>
      <Badge variant="haze">Info</Badge>
      <Badge variant="pistil">Pending</Badge>
      <Badge variant="stigma">Error</Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const AllVariants: Story = {
  render: () => {
    const sizes = ["sm", "default", "lg"] as const;
    const baseVariants = ["default", "secondary", "destructive", "outline"] as const;
    const solidVariants = ["sprout", "stigma", "growth", "pistil", "haze"] as const;
    const brutalVariants = [
      "sprout-brutal",
      "stigma-brutal",
      "growth-brutal",
      "pistil-brutal",
      "haze-brutal",
    ] as const;
    const glassVariants = [
      "sprout-glass",
      "stigma-glass",
      "growth-glass",
      "pistil-glass",
      "haze-glass",
    ] as const;

    const renderGroup = (label: string, variants: readonly string[]) => (
      <div className="flex flex-col gap-3">
        <p className="type-section-label text-text-secondary">{label}</p>
        {sizes.map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-3">
            <span className="type-mono-label w-16 text-text-tertiary">{size}</span>
            {variants.map((variant) => (
              <Badge key={`${variant}-${size}`} variant={variant as any} size={size}>
                {variant.replace(/-brutal$/, "").replace(/-glass$/, "")}
              </Badge>
            ))}
          </div>
        ))}
      </div>
    );

    return (
      <div className="flex flex-col gap-8">
        {renderGroup("Base", baseVariants)}
        {renderGroup("Solid", solidVariants)}
        {renderGroup("Brutalist", brutalVariants)}
        {renderGroup("Glass", glassVariants)}
      </div>
    );
  },
  parameters: { layout: "padded" },
};
