/**
 * Phase 2 overlay token bridge (ToolOverlay / SpeechOverlay).
 *
 * pixel-agents overlays use webview Tailwind classes (`bg-bg`, `text-text`,
 * `pixel-panel`, `text-2xs`). Kanban's surface uses `surface-*` / `text-text-*`.
 * Do not drag webview-ui CSS into Kanban — remap classes when porting.
 *
 * Usage when porting an overlay:
 *   className={mapOfficeOverlayClass("bg-bg text-text border-border")}
 * or pick from OFFICE_OVERLAY_TOKEN_MAP explicitly.
 */

/** pixel-agents class → Kanban class (1:1 where names differ). */
export const OFFICE_OVERLAY_TOKEN_MAP = {
	"bg-bg": "bg-surface-1",
	"bg-background": "bg-surface-0",
	"text-text": "text-text-primary",
	"text-foreground": "text-text-primary",
	"text-muted": "text-text-secondary",
	"text-2xs": "text-[10px]",
	"pixel-panel": "rounded-md border border-border bg-surface-1/95 shadow-sm backdrop-blur",
	"pixel-pulse": "animate-pulse",
} as const;

export type OfficeOverlaySourceClass = keyof typeof OFFICE_OVERLAY_TOKEN_MAP;

/** Rewrite space-separated pixel-agents classes to Kanban aliases; unknown tokens pass through. */
export function mapOfficeOverlayClass(classNames: string): string {
	return classNames
		.split(/\s+/)
		.filter((token) => token.length > 0)
		.map((token) => {
			if (token in OFFICE_OVERLAY_TOKEN_MAP) {
				return OFFICE_OVERLAY_TOKEN_MAP[token as OfficeOverlaySourceClass];
			}
			return token;
		})
		.join(" ");
}
