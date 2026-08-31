import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { GoogleAuth } from "google-auth-library";
import { Storage } from "@google-cloud/storage";

import { env } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";

import { toInlineImage } from "./nano-banana";
import type { MediaAsset, VideoClipRequest } from "../types";

/**
 * Gemini Omni 1.1 Flash via Vertex Agent Platform.
 *
 * Omni is not Veo and it is not `predictLongRunning`. Clips are created with
 * `POST …/v1beta1/projects/{project}/locations/global/interactions`, billed
 * against the GCP project (not AI Studio prepaid credits).
 */

const COST_PER_SECOND_USD = 0.1;

export const OMNI_LIMITS = {
  minSeconds: 3,
  maxSeconds: 10,
  maxReferenceImages: 7,
  resolution: "720p",
} as const;

export function omniConfigured(): boolean {
  return Boolean(!env.forceMockMedia && env.gcpServiceAccount && env.gcpProjectId);
}

function interactionsUrl(suffix = ""): string {
  return `https://aiplatform.googleapis.com/v1beta1/projects/${env.gcpProjectId}/locations/global/interactions${suffix}`;
}

async function bearer(): Promise<string> {
  const auth = new GoogleAuth({
    credentials: env.gcpServiceAccount as never,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Could not mint a Vertex access token for Omni.");
  return token.token;
}

export async function generateOmniClip(request: VideoClipRequest): Promise<MediaAsset> {
  if (!omniConfigured()) {
    throw new Error("Vertex is not configured, so Gemini Omni cannot be called.");
  }

  const seconds = clampDuration(request.durationSeconds);
  const references = (request.referenceImageUrls ?? []).slice(0, OMNI_LIMITS.maxReferenceImages);

  // The storyboard panel, when there is one, is the first image in the list and
  // is described as the opening frame rather than as one more reference. That
  // distinction matters: a panel treated as inspiration gets reinterpreted, and
  // the composition the image model got right is thrown away.
  const panelUrl = request.referenceImageUrl;
  const orderedRefs = panelUrl
    ? [panelUrl, ...references.filter((r) => r !== panelUrl)].slice(0, OMNI_LIMITS.maxReferenceImages)
    : references;

  const prompt = [
    `${seconds} second, ${request.aspectRatio} video.`,
    panelUrl
      ? "The FIRST attached image is the opening frame of this clip. Start from it exactly — same person, same framing, same room, same light — and animate forward from there. The images after it are the same person photographed on other days."
      : "",
    request.appearanceSeed ? `SUBJECT (must match the reference images): ${request.appearanceSeed}` : "",
    request.prompt,
    request.speech
      ? `The subject says this out loud, in sync, in the clip: "${request.speech}"`
      : request.generateAudio === false
        ? "No speech. Ambient sound only."
        : "",
    request.negativePrompt ? `Avoid: ${request.negativePrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const input: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  let refIndex = 0;
  for (const url of orderedRefs) {
    const inline = await toInlineImage(url);
    if (!inline) continue;
    input.push({ type: "image", mime_type: inline.mimeType, data: inline.data });
    refIndex += 1;
  }

  const task = refIndex > 0 ? "reference_to_video" : "text_to_video";
  const model = vertexOmniModel(env.models.video);
  const started = Date.now();
  const token = await bearer();

  const body = {
    model,
    input,
    response_format: [
      {
        type: "video",
        delivery: "uri",
        resolution: OMNI_LIMITS.resolution,
        aspect_ratio: request.aspectRatio,
        duration: `${seconds}s`,
        ...(env.gcsBucket ? { gcs_uri: `gs://${env.gcsBucket}/omni-out/` } : {}),
      },
    ],
    generation_config: {
      video_config: { task },
    },
  };

  const response = await fetch(interactionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini Omni (Vertex) responded ${response.status}: ${(await response.text()).slice(0, 700)}`);
  }

  let interaction = (await response.json()) as InteractionPayload;
  if (interaction.id && !extractVideo(interaction)) {
    interaction = await pollInteraction(interaction.id, seconds);
  }

  const video = extractVideo(interaction);
  if (!video) {
    throw new Error(
      `Gemini Omni returned no video (${interaction.status ?? "unknown status"}). ${
        interaction.error?.message ?? ""
      }`.trim(),
    );
  }

  const localUrl = await downloadClip(video, prompt);

  return {
    url: localUrl,
    mimeType: "video/mp4",
    provider: "gemini-omni",
    model,
    costUsd: seconds * COST_PER_SECOND_USD,
    durationMs: seconds * 1000,
    meta: {
      referenceCount: refIndex,
      generatedAudio: request.generateAudio !== false,
      latencyMs: Date.now() - started,
      interactionId: interaction.id,
      task,
    },
  };
}

interface InteractionPayload {
  id?: string;
  status?: string;
  error?: { message?: string };
  output_video?: { uri?: string; video_uri?: string; data?: string; mime_type?: string };
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; uri?: string; data?: string; mime_type?: string }>;
  }>;
}

function extractVideo(op: InteractionPayload): string | null {
  const uri = op.output_video?.uri ?? op.output_video?.video_uri;
  if (uri) return uri;
  if (op.output_video?.data) {
    return `data:${op.output_video.mime_type ?? "video/mp4"};base64,${op.output_video.data}`;
  }
  for (const step of op.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.uri && (part.type === "video" || part.mime_type?.startsWith("video/"))) return part.uri;
      if (part.data && (part.type === "video" || part.mime_type?.startsWith("video/"))) {
        return `data:${part.mime_type ?? "video/mp4"};base64,${part.data}`;
      }
    }
  }
  return null;
}

async function pollInteraction(id: string, seconds: number): Promise<InteractionPayload> {
  const deadline = Date.now() + 8 * 60 * 1000;
  let interval = 4000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.25, 15000);
    const token = await bearer();
    const res = await fetch(interactionsUrl(`/${encodeURIComponent(id)}`), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: "",
    });
    if (!res.ok) continue;
    const op = (await res.json()) as InteractionPayload;
    if (op.error?.message) throw new Error(`Gemini Omni: ${op.error.message}`);
    if (extractVideo(op) || op.status === "completed") return op;
    if (op.status && ["failed", "cancelled", "error"].includes(op.status.toLowerCase())) {
      throw new Error(`Gemini Omni interaction ${op.status}`);
    }
  }

  throw new Error(`Gemini Omni did not deliver the ${seconds}s clip within eight minutes.`);
}

async function downloadClip(uri: string, promptForHash: string): Promise<string> {
  const dir = path.join(GENERATED_ROOT, "clips");
  await mkdir(dir, { recursive: true });
  const name = `${createHash("sha1").update(promptForHash + uri.slice(0, 80)).digest("hex").slice(0, 16)}.mp4`;
  const filePath = path.join(dir, name);

  if (uri.startsWith("data:")) {
    const base64 = uri.slice(uri.indexOf(",") + 1);
    await writeFile(filePath, Buffer.from(base64, "base64"));
  } else if (uri.startsWith("gs://")) {
    const without = uri.slice("gs://".length);
    const slash = without.indexOf("/");
    const bucket = without.slice(0, slash);
    const object = without.slice(slash + 1);
    const storage = new Storage({
      projectId: env.gcpProjectId,
      credentials: env.gcpServiceAccount as never,
    });
    await storage.bucket(bucket).file(object).download({ destination: filePath });
  } else {
    const token = await bearer();
    const res = await fetch(uri, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Clip download failed: ${res.status}`);
    await writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  }

  return `/generated/clips/${name}`;
}

function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

function vertexOmniModel(_requested: string): string {
  // 1.1-flash (API GA id) is rejected. 1.1-flash-preview is quota-blocked on
  // this project. The preview id is the one that actually generates.
  return "gemini-omni-flash-preview";
}

function clampDuration(seconds: number): number {
  return Math.max(OMNI_LIMITS.minSeconds, Math.min(OMNI_LIMITS.maxSeconds, Math.round(seconds)));
}
