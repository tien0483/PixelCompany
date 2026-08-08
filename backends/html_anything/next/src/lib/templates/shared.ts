/**
 * Shared directives prepended to every skill's prompt body. Kept in its own
 * module so the `/api/convert` route can call `assemblePrompt({ body, … })`
 * without depending on the disk loader's full surface.
 *
 * Split into two halves because they answer to different owners:
 *
 * - The technical rules are a contract with the pipeline — "no markdown fence,
 *   first character is `<`, never write a file" is what `html-stream-parser.ts`
 *   relies on to recover HTML from the agent's stdout. Always applied.
 * - {@link VISUAL_DESIGN_DIRECTIVES} is a house design brief (Chinese-first
 *   typography, one-accent-colour palette). Right for the marketing and deck
 *   skills that make up most of the registry, wrong for a skill reproducing an
 *   existing product's chrome — those set `design_directives: none` in their
 *   frontmatter and own typography and colour themselves.
 *
 * The technical half also comes in English (`prompt_language: en`). The house
 * skills are written in Chinese and stay that way; a skill whose body, product
 * vocabulary and output are English gets a preamble that matches instead of
 * being asked to switch languages mid-prompt.
 *
 * {@link SHARED_DESIGN_DIRECTIVES} remains exported as the concatenation, so
 * the default prompt for every pre-existing skill is byte-identical.
 */

/** Which language a skill's shared preamble is emitted in. */
export type PromptLanguage = "zh" | "en";

/** Which shared design brief a skill wants. `none` = the skill body owns design. */
export type DesignDirectivesMode = "default" | "none";

/**
 * Relaxed filesystem rule for skills with `allow_read: true`. Read/Glob are
 * needed by skills whose input references local files — the plan editor stores
 * pasted screenshots in the plan's own `.assets/` folder and embeds them as
 * relative markdown links, so without Read the agent sees a filename where the
 * user expects it to see a mockup. Everything that could put HTML on disk stays
 * banned.
 */
const FS_RULE_READ_ALLOWED_ZH = `- **允许使用 Read / Glob** 读取工作目录 (plan 所在文件夹) 下的文件 — 用它们打开内容里引用的图片、截图和数据文件。**Write / Edit / MultiEdit / Bash / Create 等一切写文件的工具仍然禁止**: 不要把 HTML 写到任何 \`.html\` 文件里。前端直接捕获你的 stdout 文本, 文件落盘由前端负责。`;

const FS_RULE_STRICT_ZH = `- **禁止使用 Write / Edit / MultiEdit / Bash / Create / 任何文件系统工具**。不要把 HTML 写到任何 \`.html\` 文件里。前端直接捕获你的 stdout 文本, 文件落盘由前端负责。`;

const FS_RULE_READ_ALLOWED_EN = `- **Read / Glob are ALLOWED** for files under the working directory (the plan's own folder) — use them to open images, screenshots and data files the content references. **Write / Edit / MultiEdit / Bash / Create and any other file-creating tool remain FORBIDDEN**: never write the HTML to a \`.html\` file. The frontend captures your stdout; persisting the file is its job.`;

const FS_RULE_STRICT_EN = `- **Do NOT use Write / Edit / MultiEdit / Bash / Create or any filesystem tool.** Never write the HTML to a \`.html\` file. The frontend captures your stdout directly; persisting the file is its job.`;

function technicalOutputRulesZh(allowRead: boolean): string {
  return `
你是世界级的视觉设计师 + 资深前端工程师。请输出一份**自包含的单文件 HTML**，要求：

【内容驱动数量 — 最高优先级, 覆盖模板里的任何数字】
- 模板只定义"可用版面 / 风格 / 配色 / 字体 / 组件库", **不定义** slide / 帧 / 卡片 / section 的数量。
- 输出的 slide / frame / card / section 数量**完全由【用户内容】的实际长度和信息结构决定**。必须**完整覆盖**用户内容的每一个要点、章节、数据组, **不许总结、压缩、丢弃信息**。
- 如果模板正文里写了类似"挑 6-10 张组成 deck / 输出 6-10 帧 / 3-6 张卡片"的数字, **一律视为短示例下的参考下限, 不是上限**。短内容可以低于该范围, 长内容应远超该范围 — 用户给了 12k 字符的内容, 输出 4-6 张是**严重错误**。
- 模板里的"22 个锁死版面 / 10 个磁带式版面 / N 个 layout"指的是**可复用的版式池**, 同一个版式允许在不同内容上多次出现 (例如 KPI Tower 可以连续用 3 次承载不同章节的数据), 不是页数上限。
- 推荐做法: 先把【用户内容】按语义切成若干段 (章节标题 / 论点 / 数据组 / 列表项 / 步骤), 每一段 → 至少一个独立的 slide / section / card, 然后再从模板的版式池里给每一段挑最合适的版面。宁可多页也不要把多个独立要点硬塞进一页。

【硬性技术要求】
${allowRead ? FS_RULE_READ_ALLOWED_ZH : FS_RULE_STRICT_ZH}
- 直接把完整的 HTML 文档作为助手回复的正文流式输出。不要先说"我来生成"、"已输出至 …"之类的话。
- 文档以 \`<!DOCTYPE html>\` 开头, 末尾以 \`</html>\` 结束。
- 在 \`<head>\` 中通过 CDN 引入 Tailwind v3 Play (https://cdn.tailwindcss.com) 与所需的 Google Fonts。
- 不要引用任何外部图片 URL（除非你能保证 URL 长期有效；优先使用 CSS / SVG 内联绘制）。
- 必要的脚本（图表、动画）通过 jsdelivr CDN 引入；保持单文件可双击打开即用。
- 输出**纯 HTML**, 不要用 markdown 代码围栏包裹, 不要任何解释性文字。第一个字符必须是 \`<\`。
`;
}

function technicalOutputRulesEn(allowRead: boolean): string {
  return `
You are a world-class visual designer and senior frontend engineer. Produce a **self-contained single-file HTML document**.

[CONTENT DRIVES QUANTITY — HIGHEST PRIORITY, OVERRIDES ANY NUMBER IN THE TEMPLATE]
- The template defines the available layouts, style, palette, typography and component vocabulary. It does **not** define how many slides, frames, cards or sections to emit.
- That count follows entirely from the length and information structure of the user content. Cover **every** point, section and data group — never summarise, compress or drop information.
- Any count in the template body ("6-10 slides", "3-6 cards") is a reference floor for a short input, not a ceiling. Long input should go well past it.
- A list of layouts is a **reusable pool**: the same layout may appear many times carrying different data. It is not a page limit.
- Method: split the user content semantically (headings, claims, data groups, list items, steps), give each piece at least one section, then pick the best-fitting layout from the pool. Prefer more sections over cramming unrelated points into one.

[HARD TECHNICAL REQUIREMENTS]
${allowRead ? FS_RULE_READ_ALLOWED_EN : FS_RULE_STRICT_EN}
- Stream the complete HTML document as the body of your reply. Do not preface it with "I'll generate…" or "Written to…".
- The document starts with \`<!DOCTYPE html>\` and ends with \`</html>\`.
- In \`<head>\`, load Tailwind v3 Play (https://cdn.tailwindcss.com) and any fonts you need from a CDN.
- Do not reference external image URLs unless you can guarantee they stay valid; prefer inline CSS / SVG.
- Load any scripts you need (charts, animation) from jsdelivr; the file must work when opened directly.
- Output **pure HTML** — no markdown code fence, no explanatory prose. The first character must be \`<\`.
`;
}

function technicalOutputRules(allowRead: boolean, language: PromptLanguage): string {
  return language === "en" ? technicalOutputRulesEn(allowRead) : technicalOutputRulesZh(allowRead);
}

/** Default technical rules — Chinese, filesystem access fully denied. */
export const TECHNICAL_OUTPUT_RULES = technicalOutputRulesZh(false);

/** The house design brief. Skipped by skills that own their own design language. */
export const VISUAL_DESIGN_DIRECTIVES = `
【设计准则 — 世界级标准】
- 排版: 中文优先 \`Noto Sans SC\` / \`Noto Serif SC\`, 英文 \`Inter\` / \`Manrope\` / \`SF Pro\` 风格。
- 色彩: 使用 1 个主色 + 2 个中性色 + 至多 1 个强调色; 大胆留白; 不使用纯黑纯白 (#000/#fff), 改用 \`#0a0a0a\` / \`#fafafa\`。
- 网格: 8 px 基线; 段落最大宽度 65 ch; 标题与正文有清晰的层级。
- 微观细节: 圆角统一 (rounded-xl/2xl), 投影柔和 (shadow-sm/lg), 边框 1px \`#e5e7eb\` / \`#262626\`。
- 动效: 仅在必要处使用 \`transition-all\` 或入场 fade-in; 不要喧宾夺主。
- 无障碍: 颜色对比度 ≥ 4.5; 重要交互有 focus 态。

【内容真实性】
- **必须使用用户提供的真实数据**, 不要编造、不要 lorem ipsum、不要 "Your text here"。
- 如果用户数据是结构化数据 (CSV/JSON), 请提取关键洞察并以图表/表格呈现。
- 中文与英文混排时, 中英文之间留半角空格 (盘古之白)。

`;

/** The full default preamble: technical contract + house design brief. */
export const SHARED_DESIGN_DIRECTIVES = `${TECHNICAL_OUTPUT_RULES}${VISUAL_DESIGN_DIRECTIVES}`;

/**
 * Wrap a per-template instruction body with the shared directives and the user
 * content tail. This is the canonical prompt shape; both inline `buildPrompt`
 * functions in `index.ts` and the skill-folder loader assemble prompts via this
 * helper so behaviour stays identical.
 */
export function assemblePrompt(opts: {
  body: string;
  content: string;
  format: string;
  /** `none` drops the house design brief; the technical rules always apply. */
  designDirectives?: DesignDirectivesMode;
  /** Let the agent Read local files the content references (images, data). */
  allowRead?: boolean;
  /** Language of the shared preamble and the content labels. Defaults to `zh`. */
  language?: PromptLanguage;
}): string {
  const language: PromptLanguage = opts.language === "en" ? "en" : "zh";
  const technical = technicalOutputRules(opts.allowRead === true, language);
  const visual = opts.designDirectives === "none" ? "" : VISUAL_DESIGN_DIRECTIVES;
  const formatLabel = language === "en" ? "[INPUT FORMAT]" : "【输入格式】";
  const contentLabel = language === "en" ? "[USER CONTENT]" : "【用户内容】";
  return `${technical}${visual}
${opts.body.trim()}

${formatLabel}: ${opts.format}
${contentLabel}:
${opts.content}
`;
}
