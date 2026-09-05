import assert from "node:assert/strict";
import fs from "node:fs";

const VALID_THEMES = [
	"default",
	"graphite",
	"midnight",
	"pitch",
	"solarized-dark",
	"light",
	"overcast",
	"solarized-light",
	"latte",
	"high-contrast-dark",
	"high-contrast-light",
];

assert.equal(VALID_THEMES.length, 11);
const src = fs.readFileSync(new URL("../src/lib/themes.ts", import.meta.url), "utf8");
for (const id of VALID_THEMES) {
	assert.ok(src.includes(`"${id}"`), `missing ${id} in themes.ts`);
}
console.log(`ok ${VALID_THEMES.length} themes`);
