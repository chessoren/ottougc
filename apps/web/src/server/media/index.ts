import "server-only";

import { capabilities } from "@/lib/env";

import { MockMediaProvider } from "./providers/mock";
import { OmniMediaProvider } from "./providers/omni-provider";
import { VertexMediaProvider } from "./providers/vertex";
import type { MediaProvider } from "./types";

export * from "./types";
export { estimateAlignment } from "./providers/mock";

let provider: MediaProvider | null = null;

/**
 * One provider for the whole process.
 *
 * The decision is made once, from credentials, and reported honestly in the
 * dashboard. There is no half-live mode: either the fleet is generating real
 * media or it is generating substitutes, and the operator can see which.
 */
export function getMediaProvider(): MediaProvider {
  if (provider) return provider;

  // Omni is the video model; Vertex still supplies images, music and speech when
  // a service account is present. The composite provider routes each medium to
  // whichever backend is actually credentialed rather than forcing an
  // all-or-nothing choice.
  provider = capabilities.video.configured
    ? (new OmniMediaProvider(new VertexMediaProvider(), new MockMediaProvider()) as MediaProvider)
    : new MockMediaProvider();
  return provider;
}

export function __setMediaProvider(p: MediaProvider | null) {
  provider = p;
}
