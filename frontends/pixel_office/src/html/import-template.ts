/**
 * Uploads a template zip to the sidecar's import route.
 *
 * Goes through the runtime's sidecar proxy — the same path the rail's thumbnails use — because the
 * browser only ever talks to the runtime. The payload is base64 in JSON rather than multipart:
 * that proxy forwards string bodies only.
 */

/** Matches the sidecar's own cap, so an oversized file fails here instead of after the upload. */
export const TEMPLATE_ZIP_MAX_BYTES = 8 * 1024 * 1024;

const IMPORT_URL = "/api/html-proxy/api/templates/import";

export interface ImportedTemplate {
	id: string;
	/** True when a template with the same id already existed and was replaced. */
	replaced: boolean;
}

function toBase64(bytes: Uint8Array): string {
	// Chunked because `String.fromCharCode(...bytes)` blows the argument limit on an 8 MB file.
	const CHUNK = 0x8000;
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}
	return btoa(binary);
}

export async function importTemplateFile(file: File): Promise<ImportedTemplate> {
	if (file.size > TEMPLATE_ZIP_MAX_BYTES) {
		throw new Error(`That zip is ${Math.round(file.size / 1024 / 1024)} MB — the limit is 8 MB.`);
	}
	const dataBase64 = toBase64(new Uint8Array(await file.arrayBuffer()));
	const response = await fetch(IMPORT_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ fileName: file.name, dataBase64 }),
	});
	const payload: unknown = await response.json().catch(() => null);
	const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
	if (!response.ok) {
		// The route answers 400 with the reason the archive was refused; surfacing it is the whole
		// point, since "SKILL.md has no frontmatter" is fixable and "import failed" is not.
		const message = typeof record.error === "string" ? record.error : `Import failed (${response.status}).`;
		throw new Error(message);
	}
	const id = typeof record.id === "string" ? record.id : null;
	if (!id) {
		throw new Error("The sidecar accepted the zip but did not say which template it installed.");
	}
	return { id, replaced: record.replaced === true };
}
