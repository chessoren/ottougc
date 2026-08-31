import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GENERATED_ROOT } from "@/lib/paths";

export interface ScreencastStep {
  action: "click" | "type" | "wait" | "scroll" | "hover";
  selector?: string;
  text?: string;
  ms?: number;
}

export interface ScreencastRequest {
  url: string;
  steps: ScreencastStep[];
  durationSeconds: number;
}

export interface ScreencastResult {
  captured: boolean;
  url: string;
  provider: string;
  reason?: string;
  /** Reported so the QA agent can refuse to publish a proof format without proof. */
  isPlaceholder: boolean;
}

/**
 * Real product capture.
 *
 * Screencasts are the only asset in the pipeline that cannot be generated: they
 * are evidence. If Playwright is not installed we return an explicit placeholder
 * and say so, rather than quietly substituting a generated mock — the QA agent
 * checks `isPlaceholder` and blocks proof scenarios from
 * publishing without a genuine capture.
 */
export async function captureAppScreencast(req: ScreencastRequest): Promise<ScreencastResult> {
  const id = createHash("sha1")
    .update(req.url + JSON.stringify(req.steps))
    .digest("hex")
    .slice(0, 16);

  let chromium: typeof import("playwright").chromium | undefined;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return placeholder(id, req, "Playwright n'est pas installé dans cet environnement.");
  }

  const dir = path.join(GENERATED_ROOT, "screencasts");
  await mkdir(dir, { recursive: true });

  let browser: import("playwright").Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
      recordVideo: { dir, size: { width: 1080, height: 1920 } },
    });
    const page = await context.newPage();
    await page.goto(req.url, { waitUntil: "networkidle", timeout: 30000 });

    // A beat of stillness at the head so the first frame is a clean, readable UI.
    await page.waitForTimeout(600);

    for (const step of req.steps) {
      try {
        switch (step.action) {
          case "click":
            if (step.selector) await page.click(step.selector, { timeout: 8000 });
            break;
          case "type":
            if (step.selector && step.text) {
              // Typed character by character: instant fills look synthetic on camera.
              await page.type(step.selector, step.text, { delay: 45 });
            }
            break;
          case "hover":
            if (step.selector) await page.hover(step.selector, { timeout: 8000 });
            break;
          case "scroll":
            await page.mouse.wheel(0, step.ms ?? 600);
            break;
          case "wait":
            await page.waitForTimeout(step.ms ?? 800);
            break;
        }
      } catch {
        // A missing selector must not abort the take — the rest of the capture
        // is still usable footage.
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(280);
    }

    await page.waitForTimeout(700);
    const video = page.video();
    await context.close();

    const rawPath = video ? await video.path() : undefined;
    if (!rawPath) return placeholder(id, req, "Playwright n'a produit aucune vidéo.");

    const finalPath = path.join(dir, `${id}.webm`);
    const { rename } = await import("node:fs/promises");
    await rename(rawPath, finalPath).catch(() => undefined);

    return {
      captured: true,
      url: `/generated/screencasts/${id}.webm`,
      provider: "playwright",
      isPlaceholder: false,
    };
  } catch (err) {
    return placeholder(id, req, err instanceof Error ? err.message : String(err));
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function placeholder(
  id: string,
  req: ScreencastRequest,
  reason: string,
): Promise<ScreencastResult> {
  const dir = path.join(GENERATED_ROOT, "screencasts");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.svg`);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  await writeFile(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#101216"/>
  <rect x="60" y="300" width="960" height="1320" rx="28" fill="#171a20" stroke="#2a2f3a" stroke-width="2"/>
  <circle cx="120" cy="360" r="10" fill="#ff5f57"/><circle cx="156" cy="360" r="10" fill="#febc2e"/><circle cx="192" cy="360" r="10" fill="#28c840"/>
  <text x="540" y="700" font-family="Inter, sans-serif" font-size="42" font-weight="800" fill="#eef1f6" text-anchor="middle">CAPTURE ÉCRAN INDISPONIBLE</text>
  <text x="540" y="770" font-family="Inter, sans-serif" font-size="28" fill="#9aa3b2" text-anchor="middle">${esc(req.url.slice(0, 60))}</text>
  <text x="540" y="830" font-family="Inter, sans-serif" font-size="24" fill="#6b7280" text-anchor="middle">${esc(reason.slice(0, 70))}</text>
  <text x="540" y="900" font-family="Inter, sans-serif" font-size="24" fill="#6b7280" text-anchor="middle">${req.steps.length} étapes prévues · ${req.durationSeconds}s</text>
</svg>`,
    "utf8",
  );

  return {
    captured: false,
    url: `/generated/screencasts/${id}.svg`,
    provider: "placeholder",
    reason,
    isPlaceholder: true,
  };
}
