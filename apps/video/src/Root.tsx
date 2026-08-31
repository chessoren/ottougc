import React from "react";
import { Composition } from "remotion";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";

import { AppIcon } from "./components/AppIcon";
import { TimelineRenderer } from "./components/TimelineRenderer";
import { EMPTY_TIMELINE, FPS, HEIGHT, WIDTH, type Timeline } from "./schema";
import { DEMO_TIMELINE } from "./demo";

loadMontserrat();
loadInter();

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TimelineRenderer"
        component={TimelineRenderer as never}
        durationInFrames={Math.round((EMPTY_TIMELINE.durationMs / 1000) * FPS)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ timeline: DEMO_TIMELINE }}
        // The real duration always comes from the timeline the agent produced.
        calculateMetadata={({ props }) => {
          const timeline = (props as { timeline?: Timeline }).timeline ?? EMPTY_TIMELINE;
          return {
            durationInFrames: Math.max(30, Math.round((timeline.durationMs / 1000) * FPS)),
            fps: FPS,
            width: WIDTH,
            height: HEIGHT,
          };
        }}
      />

      {/* The desktop app's icon. Rendered to PNG with `renderStill`, so the mark
          has one source of truth and no design file to keep in sync. */}
      <Composition
        id="AppIcon"
        component={AppIcon as never}
        durationInFrames={1}
        fps={1}
        width={1024}
        height={1024}
        defaultProps={{ padding: 96 }}
      />
    </>
  );
};
