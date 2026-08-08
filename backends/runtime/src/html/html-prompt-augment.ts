// Runtime-side additions to the prompt the html-anything sidecar returns.
//
// The sidecar owns template + prompt assembly; the runtime owns the agent. Asset
// paths are a runtime fact (they come from the plan library, not the template),
// so the block that grants read access to them is appended here rather than
// pushed into the vendored prompt builder.

/**
 * Appends the image block for a plan's pasted screenshots.
 *
 * The shared directives forbid write/exec tools, and that stays true — but they
 * cannot know which files this particular run is allowed to open. Without this
 * block the agent treats `![shot](x.assets/shot.png)` as prose and designs from
 * a filename, which is exactly the "I marked up the old dashboard and nothing
 * changed" failure. Returns the prompt untouched when there is nothing to read.
 */
export function augmentHtmlPrompt(prompt: string, options: { assetPaths: string[] }): string {
	if (options.assetPaths.length === 0) {
		return prompt;
	}
	const list = options.assetPaths.map((path) => `- ${path}`).join("\n");
	return `${prompt}

【参考图片 / Reference images】
用户内容里的 \`![...](...)\` 链接对应下面这些真实文件。这些路径**允许且必须**用 Read 工具打开查看:
${list}

- 逐张打开, 看清图上的每一处标注 / 批注 / 箭头 / 圈注, 并**逐字**按它们的要求改设计。
- 图上没写的东西不要臆造; 图里的真实数字要照搬, 不要替换成示例数据。
- 除 Read 之外的文件系统与命令行工具 (Write / Edit / MultiEdit / Bash / Create) 仍然禁止使用。
- 需要在成品里嵌入这些图片时, 用内联 base64 \`data:\` URI, 不要引用本地路径或外部 URL。
`;
}
