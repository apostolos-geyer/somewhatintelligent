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
        "ink",
        "rust",
        "success",
        "warning",
        "info",
        "ink-brutal",
        "rust-brutal",
        "success-brutal",
        "warning-brutal",
        "info-brutal",
        "ink-glass",
        "rust-glass",
        "success-glass",
        "warning-glass",
        "info-glass",
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
  args: { variant: "ink", children: "Active" },
};

export const Verdigris: Story = {
  args: { variant: "success", children: "Published" },
};

export const Slate: Story = {
  args: { variant: "info", children: "Info" },
};

export const Ochre: Story = {
  args: { variant: "warning", children: "Pending" },
};

export const Blood: Story = {
  args: { variant: "rust", children: "Error" },
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
      <Badge size="sm" variant="ink">
        Small
      </Badge>
      <Badge size="default" variant="ink">
        Default
      </Badge>
      <Badge size="lg" variant="ink">
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
      <Badge variant="ink">Active</Badge>
      <Badge variant="success">Published</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="rust">Error</Badge>
      <Badge variant="outline">Draft</Badge>
    </div>
  ),
  parameters: { layout: "padded" },
};

export const AllVariants: Story = {
  render: () => {
    const sizes = ["sm", "default", "lg"] as const;
    const baseVariants = ["default", "secondary", "destructive", "outline"] as const;
    const solidVariants = ["ink", "rust", "success", "warning", "info"] as const;
    const brutalVariants = [
      "ink-brutal",
      "rust-brutal",
      "success-brutal",
      "warning-brutal",
      "info-brutal",
    ] as const;
    const glassVariants = [
      "ink-glass",
      "rust-glass",
      "success-glass",
      "warning-glass",
      "info-glass",
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
