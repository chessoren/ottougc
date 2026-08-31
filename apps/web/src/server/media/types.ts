/** Everything the pipeline can ask a media provider to produce. */

export interface VideoClipRequest {
  prompt: string;
  /** Locked physical description of the persona, prepended to every prompt so the
   *  same face comes back across hundreds of clips. */
  appearanceSeed?: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  /**
   * The character sheet, as image URLs.
   *
   * Gemini Omni Flash accepts up to seven reference images, and passing the same
   * set into every generation is the only reliable way to get one recognisable
   * person across a hundred clips. A text description alone drifts — same words,
   * different face — and an audience spots that faster than any other tell.
   */
  referenceImageUrls?: string[];
  /** Single still to animate from. Kept for image-to-video providers. */
  referenceImageUrl?: string;
  /**
   * Omni generates audio with the picture. Left on for scenarios with sync
   * dialogue; switched off when the timeline supplies its own voice track.
   */
  generateAudio?: boolean;
  /** The line to be spoken in-clip, when audio is generated natively. */
  speech?: string;
  /** Cheaper, faster model tier. */
  fast?: boolean;
  negativePrompt?: string;
  seed?: number;
}

export interface ImageRequest {
  prompt: string;
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:5";
  /** Reuse across a set so a photo series looks shot on one device, one day. */
  seed?: number;
  count?: number;
  /** Nano Banana 2 (`gemini-3-pro-image`) vs the faster Flash Image tier. */
  hiFi?: boolean;
  /**
   * Photographs to condition on.
   *
   * This is what makes a character sheet a sheet rather than seven strangers,
   * and what lets storyboard panel N inherit the room from panel N-1.
   */
  referenceImageUrls?: string[];
  /**
   * What the reference photographs are evidence *of*.
   *
   * The distinction is load-bearing. A character sheet needs seven pictures of
   * one person in different clothes, rooms and moods, so only the identity may
   * be copied. A storyboard needs consecutive frames of one continuous moment,
   * so the room, the wardrobe and the light must be copied too. Telling the
   * model to preserve everything in the first case produces seven copies of the
   * same photograph, which is a sheet that teaches the video model nothing.
   */
  preserve?: "IDENTITY" | "SCENE";
  /** Excluded explicitly rather than hoped away. */
  negativePrompt?: string;
  /** 2K when the image will be fed to the video model, which resamples it. */
  size?: "1K" | "2K";
}

export interface MusicRequest {
  prompt: string;
  durationSeconds: number;
  bpm?: number;
  /** Ask the provider for the downbeat grid so the editor can cut on the beat. */
  wantBeatGrid?: boolean;
}

export interface SpeechRequest {
  text: string;
  voiceName: string;
  languageCode: string;
  speakingRate?: number;
  pitch?: number;
  /** Broadcast target. Short-form platforms normalise to about -14 LUFS. */
  targetLufs?: number;
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  /** True when the word carries the emphasis — highlighted in kinetic captions. */
  emphasis?: boolean;
}

export interface AlignmentResult {
  words: TranscriptWord[];
  /** End of each breath group — where the editor is allowed to cut. */
  breathGroupEndsMs: number[];
  durationMs: number;
}

export interface MediaAsset {
  url: string;
  localPath?: string;
  mimeType: string;
  provider: string;
  model: string;
  costUsd: number;
  durationMs?: number;
  width?: number;
  height?: number;
  meta?: Record<string, unknown>;
}

export interface MusicAsset extends MediaAsset {
  /** Timestamps of the downbeats, in ms. Empty when the provider cannot report them. */
  beatGridMs: number[];
  bpm: number;
}

export interface SpeechAsset extends MediaAsset {
  alignment: AlignmentResult;
}

export interface MediaProvider {
  readonly name: string;
  readonly live: boolean;

  generateVideoClip(req: VideoClipRequest): Promise<MediaAsset>;
  generateImages(req: ImageRequest): Promise<MediaAsset[]>;
  generateMusic(req: MusicRequest): Promise<MusicAsset>;
  synthesizeSpeech(req: SpeechRequest): Promise<SpeechAsset>;
  /** Word-level alignment of an existing audio file against its transcript. */
  alignTranscript(audioPath: string, transcript: string): Promise<AlignmentResult>;
}

/** Published unit prices, used for budget enforcement and margin reporting. */
export const MEDIA_PRICING = {
  /** Veo 3.1, per second of generated video. */
  veoPerSecond: 0.4,
  veoFastPerSecond: 0.15,
  /** Gemini Flash Image, per image. */
  imagePerImage: 0.039,
  /** Imagen 4, per image. */
  imageHiFiPerImage: 0.06,
  /** Lyria, per 30s clip. */
  musicPerClip: 0.06,
  /** Cloud TTS Chirp 3 HD, per million characters. */
  ttsPerMillionChars: 30,
  /** Cloud STT, per minute. */
  sttPerMinute: 0.016,
} as const;
