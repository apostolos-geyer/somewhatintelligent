import type { Meta, StoryObj } from "@storybook/react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./accordion";

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion className="w-96">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is Platform?</AccordionTrigger>
        <AccordionContent>
          A multi-app platform built on ancient futurism. Dark-first design, obsidian surfaces, pale
          electric blue accents.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>What design system is this?</AccordionTrigger>
        <AccordionContent>
          The Glyph system — neobrutalist cards, neumorphic surfaces, glassmorphism overlays, and a
          five-accent mineral palette.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>What fonts are used?</AccordionTrigger>
        <AccordionContent>
          Boska for display, Iosevka Aile for body, Literata for editorial prose, and Iosevka for
          monospace.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
