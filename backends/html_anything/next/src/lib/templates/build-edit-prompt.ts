/**
 * Lifted from upstream `app/api/convert/route.ts` (PixelOffice fork).
 * Diff-edit path: ask the agent for a minimal HTML edit instead of a full regen.
 */
export function buildEditPrompt(args: {
  templateName: string;
  templateAspect: string;
  newContent: string;
  oldContent: string;
  oldHtml: string;
  format: string;
}): string {
  return `You are performing a **minimal diff-edit**, not regenerating from scratch.

Template style: ${args.templateName} (${args.templateAspect})
Input format: ${args.format}

[HARD RULES]
1. Output only the complete, modified HTML. The first character must be \`<\`, the last must be \`</html>\`.
2. **Do not** wrap it in a markdown fence and include no explanatory prose.
3. **Do NOT use file tools such as Write / Edit / MultiEdit / Bash** — the HTML must be streamed directly in the body of your reply; do not save it to a \`.html\` file and then reply "Written to…".
4. Keep the original HTML's \`<head>\` (CDN / fonts / styles / meta) and preserve every DOM structure that does not need to change — fonts, palette, layout, grid, component structure and animations must stay untouched.
5. Only replace or adjust the text / data nodes that differ between "old content" and "new content".
6. If the new content adds items, reuse the existing card / row / slide / section structure; if it removes items, drop the corresponding elements.
7. If old and new content differ by only a few characters, change only those characters — do not "optimise" or "reflow" as a side effect.
8. Do not invent data. If it is not in the new content, do not write it.

[OLD CONTENT]
${args.oldContent}

[NEW CONTENT]
${args.newContent}

[EXISTING HTML — modify this and output the complete updated version]
${args.oldHtml}
`;
}

/**
 * Diff-edit path proper: the caller already knows exactly what changed in the requirement, so
 * the prompt carries a unified diff instead of both full versions of the markdown. That is the
 * difference between "here are two documents, work out the delta" and "apply this delta" — and
 * it keeps a one-line requirement change from costing a full requirement in tokens.
 */
export function buildDiffEditPrompt(args: {
  templateName: string;
  templateAspect: string;
  diff: string;
  oldHtml: string;
  format: string;
}): string {
  return `You are performing a **minimal diff-edit**, not regenerating from scratch.

Template style: ${args.templateName} (${args.templateAspect})
Input format: ${args.format}

[HARD RULES]
1. Output only the complete, modified HTML. The first character must be \`<\`, the last must be \`</html>\`.
2. **Do not** wrap it in a markdown fence and include no explanatory prose.
3. **Do NOT use file tools such as Write / Edit / MultiEdit / Bash** — the HTML must be streamed directly in the body of your reply; do not save it to a \`.html\` file and then reply "Written to…".
4. Keep the original HTML's \`<head>\` (CDN / fonts / styles / meta) and preserve every DOM structure that does not need to change — fonts, palette, layout, grid, component structure and animations must stay untouched.
5. The diff below is the **only** change to apply. Every part of the HTML that the diff does not touch must come back byte-identical.
6. If the diff adds items, reuse the existing card / row / slide / section structure; if it removes items, drop the corresponding elements.
7. If the diff changes only a few characters, change only those characters — do not "optimise" or "reflow" as a side effect.
8. Do not invent data. If it is not in the diff or already in the HTML, do not write it.

[REQUIREMENT DIFF — unified diff of the source document; \`-\` lines were removed, \`+\` lines were added, unprefixed lines are unchanged context]
${args.diff}

[EXISTING HTML — modify this and output the complete updated version]
${args.oldHtml}
`;
}
