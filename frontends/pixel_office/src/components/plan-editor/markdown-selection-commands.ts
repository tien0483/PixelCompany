export interface TextSelectionState {
	value: string;
	selectionStart: number;
	selectionEnd: number;
}

/**
 * Wrap the selection in `prefix`/`suffix` (e.g. `**bold**`), or unwrap it if the
 * selection is already immediately surrounded by them. With an empty selection,
 * inserts an empty pair and places the cursor between them.
 */
export function toggleWrap(state: TextSelectionState, prefix: string, suffix: string = prefix): TextSelectionState {
	const { value, selectionStart, selectionEnd } = state;
	const before = value.slice(0, selectionStart);
	const selected = value.slice(selectionStart, selectionEnd);
	const after = value.slice(selectionEnd);

	const isWrapped = before.endsWith(prefix) && after.startsWith(suffix);
	if (isWrapped) {
		const nextValue = before.slice(0, before.length - prefix.length) + selected + after.slice(suffix.length);
		const nextStart = selectionStart - prefix.length;
		return {
			value: nextValue,
			selectionStart: nextStart,
			selectionEnd: nextStart + selected.length,
		};
	}

	const nextValue = `${before}${prefix}${selected}${suffix}${after}`;
	const nextStart = selectionStart + prefix.length;
	return {
		value: nextValue,
		selectionStart: nextStart,
		selectionEnd: nextStart + selected.length,
	};
}

function lineBounds(value: string, index: number): { start: number; end: number } {
	const start = value.lastIndexOf("\n", index - 1) + 1;
	const nextBreak = value.indexOf("\n", index);
	const end = nextBreak === -1 ? value.length : nextBreak;
	return { start, end };
}

/**
 * Toggle a line-leading marker (e.g. `"# "`, `"- "`) on every line touched by
 * the selection. Removes the marker if every touched line already has it,
 * otherwise adds it to lines that don't.
 */
export function togglePrefix(state: TextSelectionState, marker: string): TextSelectionState {
	const { value, selectionStart, selectionEnd } = state;
	const { start: blockStart } = lineBounds(value, selectionStart);
	const { end: blockEnd } = lineBounds(value, Math.max(selectionEnd, selectionStart));
	const block = value.slice(blockStart, blockEnd);
	const lines = block.split("\n");

	const allPrefixed = lines.every((line) => line.startsWith(marker));
	const nextLines = allPrefixed
		? lines.map((line) => line.slice(marker.length))
		: lines.map((line) => (line.startsWith(marker) ? line : `${marker}${line}`));
	const nextBlock = nextLines.join("\n");

	const delta = nextBlock.length - block.length;
	const firstLineDelta = allPrefixed
		? lines[0]?.startsWith(marker)
			? -marker.length
			: 0
		: lines[0]?.startsWith(marker)
			? 0
			: marker.length;

	return {
		value: value.slice(0, blockStart) + nextBlock + value.slice(blockEnd),
		selectionStart: Math.max(blockStart, selectionStart + firstLineDelta),
		selectionEnd: selectionEnd + delta,
	};
}

/** Replace the current selection with `text`, placing the cursor after it. */
export function insertAtCursor(state: TextSelectionState, text: string): TextSelectionState {
	const { value, selectionStart, selectionEnd } = state;
	const nextValue = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
	const nextCursor = selectionStart + text.length;
	return {
		value: nextValue,
		selectionStart: nextCursor,
		selectionEnd: nextCursor,
	};
}
