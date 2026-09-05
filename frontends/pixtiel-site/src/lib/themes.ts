export const VALID_THEMES = [
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
] as const;

export type ThemeId = (typeof VALID_THEMES)[number];

export const LIGHT_THEMES = new Set<string>([
	"light",
	"overcast",
	"solarized-light",
	"latte",
	"high-contrast-light",
]);

export const THEME_LABELS: Record<ThemeId, string> = {
	default: "Default",
	graphite: "Graphite",
	midnight: "Midnight",
	pitch: "Pitch",
	"solarized-dark": "Solarized Dark",
	light: "Light",
	overcast: "Overcast",
	"solarized-light": "Solarized Light",
	latte: "Latte",
	"high-contrast-dark": "High Contrast Dark",
	"high-contrast-light": "High Contrast Light",
};
