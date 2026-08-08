/**
 * User-visible copy for the HTML generation surface.
 * Files/types keep html-anything / vendor names for traceability; people see these labels.
 */
export const HTML_LABELS = {
	section: "HTML",
	generate: "Generate HTML",
	offline: "HTML templates offline",
	offlineHint: "Templates appear when the companion sidecar is running.",
	pickTemplate: "Choose a template",
	saveSibling: "Save as HTML plan",
	preview: "Preview",
	plain: "Source",
	streaming: "Generating…",
	emptyTemplates: "No templates available.",
	convert: "Convert to HTML",
	source: "Source",
	log: "Log",
	elapsed: "Elapsed",
	ttfb: "TTFB",
	size: "Size",
	agent: "Agent",
	online: "Online",
	offlineShort: "Offline",
	noLog: "No log output yet.",
	expand: "Expand brief",
	expandHint: "Reads the plan's images and rewrites the notes as a structured brief. Review it before generating.",
	expanding: "Expanding…",
	expandDone: "Brief added below your notes.",
	expandNeedsPlan: "Save the plan first — expansion reads its images from disk.",
	refine: "Refine",
	refineHint: "Edits the HTML you already have instead of regenerating it from scratch.",
	refineNeedsHtml: "Generate HTML once before refining it.",
} as const;
