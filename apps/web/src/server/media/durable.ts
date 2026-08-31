import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { Storage } from "@google-cloud/storage";

import { env, googleCredentials } from "@/lib/env";
import { GENERATED_ROOT } from "@/lib/paths";

/**
 * Keeping media that outlives the container that made it.
 *
 * On a laptop the generated folder is durable and none of this matters. On
 * Cloud Run the filesystem is in memory and disappears when the instance scales
 * to zero — which it does within minutes of the daily run finishing. A rendered
 * video that only exists there is a video that exists until lunchtime.
 *
 * So anything a person will look at later — the finished MP4, the storyboard
 * panels, the character sheet — is copied to Cloud Storage, and the media route
 * falls back to the bucket when the local file is gone. Intermediates are not:
 * a clip that has already been cut into a timeline is never read again, and
 * paying to store forty seconds of footage nobody will open is waste.
 */

let storage: Storage | null = null;

function bucket() {
  if (!env.gcsBucket) return null;
  if (!storage) {
    storage = new Storage({
      projectId: env.gcpProjectId,
      ...googleCredentials(),
    });
  }
  return storage.bucket(env.gcsBucket);
}

export function durableStorageConfigured(): boolean {
  return Boolean(env.gcsBucket && env.gcpAuthAvailable);
}

/**
 * Copy a generated file to the bucket, keeping its path.
 *
 * The object key mirrors the local path exactly — `videos/abc.mp4` here is
 * `videos/abc.mp4` there — so one URL keeps working whichever side answers it,
 * and nothing downstream needs to know where the file physically is.
 *
 * Never throws. A video that rendered but could not be uploaded is still a
 * video, and failing the run over it would be the wrong trade.
 */
export async function keepDurable(generatedUrl: string): Promise<boolean> {
  const target = bucket();
  if (!target) return false;

  const relative = generatedUrl.replace(/^\/generated\//, "");
  const local = path.join(GENERATED_ROOT, relative);

  try {
    await stat(local);
  } catch {
    return false;
  }

  try {
    await target.upload(local, {
      destination: relative,
      resumable: false,
      metadata: {
        // These are immutable: the filename is a hash of what made them.
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a generated file back, from wherever it survives.
 *
 * Local first — it is faster and it is where a file lives during the run that
 * made it. The bucket is the fallback for everything that outlived its
 * container.
 */
export async function openGenerated(
  relative: string,
): Promise<{ stream: NodeJS.ReadableStream; size: number; source: "local" | "bucket" } | null> {
  const local = path.join(GENERATED_ROOT, relative);

  try {
    const info = await stat(local);
    if (info.isFile()) {
      return { stream: createReadStream(local), size: info.size, source: "local" };
    }
  } catch {
    // Falls through to the bucket.
  }

  const target = bucket();
  if (!target) return null;

  try {
    const file = target.file(relative);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [meta] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      size: Number(meta.size ?? 0),
      source: "bucket",
    };
  } catch {
    return null;
  }
}
