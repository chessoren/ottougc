import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    // PGlite ships a WASM bundle and resolves its data directory at runtime;
    // bundling it makes Node receive a URL where it expects a path.
    "@electric-sql/pglite",
    "postgres",
    "googleapis",
    "google-auth-library",
    "@google-cloud/storage",
    "@google-cloud/text-to-speech",
    "@google-cloud/speech",
    "@google/genai",
    // Remotion's bundler pulls in a native rspack binding; letting webpack try to
    // parse a .node binary fails the build. These only ever run server-side.
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/compositor-darwin-arm64",
    "@remotion/compositor-linux-x64-gnu",
    "@rspack/core",
    "@rspack/binding",
    "playwright",
  ],
  experimental: {
    // Agent runs are long; give server actions room to breathe.
    serverActions: { bodySizeLimit: "8mb" },
  },
  // Two lockfiles exist above this directory on some machines; pin the root so
  // Next does not infer the wrong one and mis-trace server files.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
    ],
  },
};

export default nextConfig;
