/**
 * Prompt-text markers that bind an attached image to the spot in the prompt where it was
 * pasted. The runtime rewrites each marker into the staged image's absolute path
 * (`backends/runtime/src/terminal/task-image-prompt.ts`), so the agent reads the file path
 * in the same sentence the user pasted it into instead of a list prepended to the prompt.
 *
 * The marker label is the image's `name`, which is why names have to be unique per task —
 * see {@link resolveUniqueTaskImageLabel}.
 */

export function buildTaskImageMarker(label: string): string {
	return `[image: ${label.trim()}]`;
}

function escapeRegExp(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches `[image: label]` with any inner padding, plus one space in front of it if present. */
function buildTaskImageMarkerPattern(label: string): RegExp {
	return new RegExp(`[ \\t]?\\[image:\\s*${escapeRegExp(label.trim())}\\s*\\]`, "g");
}

/** Remove every marker for `label`, so deleting an image chip leaves no orphan token behind. */
export function stripTaskImageMarker(text: string, label: string): string {
	const trimmedLabel = label.trim();
	if (trimmedLabel.length === 0) {
		return text;
	}
	const next = text.replaceAll(buildTaskImageMarkerPattern(trimmedLabel), "");
	// Removing the first of several consecutive markers leaves the next one's separator space
	// stranded at the start of the prompt.
	if (/^[ \t]/.test(next) && !/^[ \t]/.test(text)) {
		return next.replace(/^[ \t]+/, "");
	}
	return next;
}

/**
 * Clipboard pastes nearly always arrive as `image.png`, so collisions are the norm rather than
 * the exception. Suffix `-2`, `-3`, ... before the extension until the label is free.
 */
export function resolveUniqueTaskImageLabel(name: string | undefined, taken: Iterable<string>): string {
	const takenLabels = new Set<string>();
	for (const label of taken) {
		const trimmed = label.trim();
		if (trimmed.length > 0) {
			takenLabels.add(trimmed);
		}
	}

	const base = name?.trim() || "image";
	if (!takenLabels.has(base)) {
		return base;
	}

	const dotIndex = base.lastIndexOf(".");
	const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base;
	const extension = dotIndex > 0 ? base.slice(dotIndex) : "";
	for (let suffix = 2; ; suffix++) {
		const candidate = `${stem}-${suffix}${extension}`;
		if (!takenLabels.has(candidate)) {
			return candidate;
		}
	}
}
