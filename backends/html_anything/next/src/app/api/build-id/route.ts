export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports the build this *process* is serving. The value is inlined at build
 * time by `next.config.ts`, so it does not change when `.next/BUILD_ID` is
 * overwritten by a later build underneath a still-running server. That is
 * exactly what makes it usable as a staleness check.
 */
export function GET(): Response {
  return Response.json({ buildId: process.env.HTML_ANYTHING_BUILD_ID ?? null });
}
