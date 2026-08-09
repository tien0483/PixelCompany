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
