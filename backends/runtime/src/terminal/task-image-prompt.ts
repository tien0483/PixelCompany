import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import type { RuntimeTaskImage } from "../core/api-contract";

export const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/svg+xml": ".svg",
	"image/webp": ".webp",
};

export function sanitizeFileNameSegment(value: string): string {
	const normalized = value.normalize("NFKD").replaceAll(/[^A-Za-z0-9._-]+/g, "-");
	const trimmed = normalized.replaceAll(/^-+|-+$/g, "");
	return trimmed.length > 0 ? trimmed : "image";
}

export function resolveImageExtension(name: string | undefined, mimeType: string): string {
	const trimmedName = name?.trim();
	const nameExtension = trimmedName ? extname(trimmedName).toLowerCase() : "";
	if (nameExtension) {
		return nameExtension;
	}
	return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()] ?? "";
}

function resolveTaskImageExtension(image: RuntimeTaskImage): string {
	return resolveImageExtension(image.name, image.mimeType);
}

function buildTaskImageFileName(image: RuntimeTaskImage, index: number): string {
	const displayName = image.name?.trim();
	const extension = resolveTaskImageExtension(image);
	const baseName = displayName ? basename(displayName, extname(displayName)) : `image-${index + 1}`;
	return `${String(index + 1).padStart(2, "0")}-${sanitizeFileNameSegment(baseName)}${extension}`;
}

function buildTaskPromptWithImagePaths(
	prompt: string,
	imageFileEntries: Array<{ path: string; name?: string }>,
): string {
	const lines = [
		"Attached reference images:",
		...imageFileEntries.map((entry, index) => {
			const displaySuffix = entry.name?.trim() ? ` (${entry.name.trim()})` : "";
			return `${index + 1}. ${entry.path}${displaySuffix}`;
		}),
	];
	const trimmedPrompt = prompt.trim();
	if (!trimmedPrompt) {
		return lines.join("\n");
	}
	return [...lines, "", "Task:", trimmedPrompt].join("\n");
}

export async function prepareTaskPromptWithImages(input: {
	prompt: string;
	images?: RuntimeTaskImage[];
}): Promise<string> {
	const images = input.images?.filter((image) => image.data.trim().length > 0) ?? [];
	if (images.length === 0) {
		return input.prompt;
	}

	const tempDir = await mkdtemp(join(tmpdir(), "kanban-task-images-"));
	const imageFileEntries = await Promise.all(
		images.map(async (image, index) => {
			const filePath = join(tempDir, buildTaskImageFileName(image, index));
			await writeFile(filePath, Buffer.from(image.data, "base64"));
			return {
				path: filePath,
				name: image.name,
			};
		}),
	);

	return buildTaskPromptWithImagePaths(input.prompt, imageFileEntries);
}
