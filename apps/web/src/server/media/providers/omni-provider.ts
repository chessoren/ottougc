import { env } from "@/lib/env";

import { generateOmniClip, omniConfigured } from "./omni";
import type {
  AlignmentResult,
  ImageRequest,
  MediaAsset,
  MediaProvider,
  MusicAsset,
  MusicRequest,
  SpeechAsset,
  SpeechRequest,
  VideoClipRequest,
} from "../types";

/**
 * Composite provider.
 *
 * Video goes to Gemini Omni Flash. Images, music and speech go to Vertex when a
 * service account is present, and to the substitute provider otherwise.
 *
 * The split exists because the two backends are credentialed differently: an AI
 * Studio key alone unlocks Omni, while Imagen, Lyria and Chirp need a Google
 * Cloud service account. Forcing one decision for all four media would leave a
 * user with a key generating nothing.
 */
export class OmniMediaProvider implements MediaProvider {
  readonly name = "omni";
  readonly live = true;

  constructor(
    private readonly vertex: MediaProvider,
    private readonly fallback: MediaProvider,
  ) {}

  async generateVideoClip(request: VideoClipRequest): Promise<MediaAsset> {
    if (!omniConfigured()) return this.fallback.generateVideoClip(request);
    try {
      return await generateOmniClip(request);
    } catch (error) {
      // A failed clip must degrade to a labelled substitute rather than kill the
      // run: QA refuses to publish substitutes, so nothing unsafe reaches a
      // channel, and the operator sees the real error in the trace.
      const asset = await this.fallback.generateVideoClip(request);
      return {
        ...asset,
        meta: {
          ...(asset.meta ?? {}),
          omniError: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private imageBackend(): MediaProvider {
    return env.gcpAuthAvailable && env.gcpProjectId ? this.vertex : this.fallback;
  }

  generateImages(request: ImageRequest): Promise<MediaAsset[]> {
    return this.imageBackend().generateImages(request);
  }

  generateMusic(request: MusicRequest): Promise<MusicAsset> {
    return this.imageBackend().generateMusic(request);
  }

  synthesizeSpeech(request: SpeechRequest): Promise<SpeechAsset> {
    return this.imageBackend().synthesizeSpeech(request);
  }

  alignTranscript(audioUrl: string, text: string): Promise<AlignmentResult> {
    return this.imageBackend().alignTranscript(audioUrl, text);
  }
}
