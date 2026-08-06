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
  return `你正在执行一次**最小化差异编辑** (diff-edit), 不是从 0 重新生成。

模板风格: ${args.templateName} (${args.templateAspect})
输入格式: ${args.format}

【硬性规则】
1. 仅输出完整的、修改后的 HTML。第一个字符必须是 \`<\`, 最后必须是 \`</html>\`。
2. **不要**用 markdown 围栏包裹, 不要任何解释性文字。
3. **禁止使用 Write / Edit / MultiEdit / Bash 等文件工具** — HTML 必须直接在助手回复正文里流式输出, 不要存到 \`.html\` 文件再回复"已输出至 …"。
4. 保留原 HTML 的 \`<head>\` (CDN / 字体 / 样式 / meta), 保留所有不需要变化的 DOM 结构 — 字体、配色、布局、栅格、组件结构、动画都不许改。
5. 仅根据 "旧内容 vs 新内容" 的差异, 替换或调整对应的文字 / 数据节点。
6. 如果新内容增加了条目, 沿用原有的卡片 / 行 / slide / 章节结构添加; 如果删除了条目, 移除对应的元素。
7. 如果新旧内容只差几个字, 也只改那几个字 — 不要顺手 "优化" 或 "重排"。
8. 不要捏造数据。新内容里没有的就不要写。

【旧内容】
${args.oldContent}

【新内容】
${args.newContent}

【已有 HTML — 请基于此修改, 输出完整的修改后版本】
${args.oldHtml}
`;
}
