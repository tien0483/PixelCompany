import { importTemplateZip, TemplateImportError, ZIP_MAX_BYTES } from "@/lib/templates/import-zip";
import { invalidateSkillsCache } from "@/lib/templates/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Installs a template skill from a zip the user picked in the editor.
 *
 * The payload is base64 in JSON rather than multipart: the runtime proxies every sidecar call as a
 * string body (`/api/html-proxy/*`), so binary would not survive the hop.
 *
 * Runs here rather than in the runtime because this process owns both ends of the problem — it
 * resolves the templates directory (`agent-data-root.ts`) and it caches the picker's metadata
 * listing in production, so only it can drop that cache.
 */

/** base64 of the 8 MB zip cap, plus room for the JSON envelope. */
const MAX_BASE64_LENGTH = Math.ceil((ZIP_MAX_BYTES * 4) / 3) + 1024;

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const body = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const dataBase64 = typeof body.dataBase64 === "string" ? body.dataBase64 : null;
  const fileName = typeof body.fileName === "string" ? body.fileName : undefined;
  if (!dataBase64) {
    return Response.json({ error: "dataBase64 is required" }, { status: 400 });
  }
  if (dataBase64.length > MAX_BASE64_LENGTH) {
    return Response.json({ error: `the zip exceeds the ${ZIP_MAX_BYTES}-byte cap` }, { status: 413 });
  }

  const zipBytes = Buffer.from(dataBase64, "base64");

  try {
    const result = await importTemplateZip(zipBytes, fileName === undefined ? {} : { fileName });
    // Production caches the listing, so without this the new folder stays invisible until restart.
    invalidateSkillsCache();
    return Response.json(result);
  } catch (error) {
    if (error instanceof TemplateImportError) {
      // A rejected archive is the user's file being wrong, not the server failing: 400 so the
      // editor shows the reason instead of a generic failure toast.
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : String(error), code: "install_failed" },
      { status: 500 },
    );
  }
}
