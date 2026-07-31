import type { SpriteData } from "../types.js";

/** A pixel with alpha below this reads as fully transparent. */
export const PNG_ALPHA_THRESHOLD = 2;

/**
 * Upstream's rgbaToHex. Emits 8-digit hex only for partially-transparent pixels so
 * fully-opaque output matches the 6-digit form the colorize cache keys on.
 */
export function rgbaToHex(r: number, g: number, b: number, a: number): string {
	if (a < PNG_ALPHA_THRESHOLD) {
		return "";
	}
	const rgb = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
		.toString(16)
		.padStart(2, "0")}`.toUpperCase();
	if (a >= 255) {
		return rgb;
	}
	return `${rgb}${a.toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Pack raw RGBA bytes (row-major) into SpriteData for golden / unit tests. */
export function decodePngToSpriteData(rgba: Uint8ClampedArray, width: number, height: number): SpriteData {
	const sprite: SpriteData = [];
	for (let y = 0; y < height; y++) {
		const row: string[] = [];
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 4;
			row.push(
				rgbaToHex(rgba[idx] ?? 0, rgba[idx + 1] ?? 0, rgba[idx + 2] ?? 0, rgba[idx + 3] ?? 0),
			);
		}
		sprite.push(row);
	}
	return sprite;
}
