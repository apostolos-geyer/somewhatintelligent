import React from "react";
import { Composition } from "remotion";
import "./load-fonts";
import { SproutOverview, OVERVIEW_DURATION } from "./compositions/SproutOverview";
import {
  SpotlightWhiteLabel,
  SpotlightDropSheet,
  SpotlightLearnEarn,
  SPOTLIGHT_DURATION,
} from "./compositions/Spotlights";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Flagship product film — 1080p, ~34s. */}
      <Composition
        id="SproutOverview"
        component={SproutOverview}
        durationInFrames={OVERVIEW_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />

      {/* Vertical 9:16 social spotlights — 12s each. */}
      <Composition
        id="SpotlightWhiteLabel"
        component={SpotlightWhiteLabel}
        durationInFrames={SPOTLIGHT_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="SpotlightDropSheet"
        component={SpotlightDropSheet}
        durationInFrames={SPOTLIGHT_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="SpotlightLearnEarn"
        component={SpotlightLearnEarn}
        durationInFrames={SPOTLIGHT_DURATION}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
