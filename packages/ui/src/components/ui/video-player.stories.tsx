import type { Meta, StoryObj } from "@storybook/react";
import { VideoPlayer } from "./video-player";

const meta = {
  title: "UI/VideoPlayer",
  component: VideoPlayer,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  argTypes: {
    src: { control: "text" },
    fileName: { control: "text" },
  },
} satisfies Meta<typeof VideoPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
    fileName: "flower.webm",
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
};

export const WithLongFilename: Story = {
  args: {
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
    fileName: "2024-03-15_project-demo_final-cut_v3_approved_for-release.mp4",
  },
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
};
