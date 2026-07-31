import { describe, expect, it } from "vitest";

import { decodePngToSpriteData } from "../assets/decode-png.js";

/**
 * Golden-ish decode smoke: transparent + opaque pixels survive browser-style
 * hex conversion. Full PNG fixture parity with pngjs lives behind createImageBitmap
 * in the browser loader; this unit covers the shared hex packing path.
 */
describe("office sprite decode helpers", () => {
	it("maps RGBA bytes into SpriteData hex rows with empty transparent cells", () => {
		// 2x1: opaque red, fully transparent
		const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
		const sprite = decodePngToSpriteData(rgba, 2, 1);
		expect(sprite).toEqual([["#FF0000", ""]]);
	});
});
