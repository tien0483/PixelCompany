import type { NextConfig } from "next";

/**
 * One id per `next build`, baked into the server bundle *and* written to
 * `.next/BUILD_ID`. The PixelOffice runtime compares the two to tell a freshly
 * built sidecar from an orphaned older process still holding port 8322 — see
 * `backends/runtime/src/html/html-process.ts`.
 *
 * The env write-back matters: `next build` re-evaluates this config in its
 * worker processes, which inherit the parent's `process.env`, so every
 * evaluation in one build agrees on the value.
 */
const buildId = process.env.HTML_ANYTHING_BUILD_ID ?? `b${Date.now().toString(36)}`;
process.env.HTML_ANYTHING_BUILD_ID = buildId;

const nextConfig: NextConfig = {
  generateBuildId: () => buildId,
  env: { HTML_ANYTHING_BUILD_ID: buildId },
};

export default nextConfig;
