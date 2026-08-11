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
 * - {@link VISUAL_DESIGN_DIRECTIVES} is a house design brief (reader-first
 *   typography, one-accent-colour palette). Right for the marketing and deck
 *   skills that make up most of the registry, wrong for a skill reproducing an
 *   existing product's chrome — those set `design_directives: none` in their
 *   frontmatter and own typography and colour themselves.
 *
 * The entire preamble is emitted in English. Skill frontmatter may still set
 * `prompt_language`, but both values resolve to the same English preamble.
 *
 * {@link SHARED_DESIGN_DIRECTIVES} remains exported as the concatenation, so
 * the default prompt for every pre-existing skill is byte-identical.
 */

/** Which language a skill's shared preamble is emitted in. English is the only
 * emitted language; `zh` is accepted for backward compatibility with skill
 * frontmatter that sets `prompt_language` explicitly. */
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
const FS_RULE_READ_ALLOWED = `- **Read / Glob are ALLOWED** for files under the working directory (the plan's own folder) — use them to open images, screenshots and data files the content references. **Write / Edit / MultiEdit / Bash / Create and any other file-creating tool remain FORBIDDEN**: never write the HTML to a \`.html\` file. The frontend captures your stdout; persisting the file is its job.`;

const FS_RULE_STRICT = `- **Do NOT use Write / Edit / MultiEdit / Bash / Create or any filesystem tool.** Never write the HTML to a \`.html\` file. The frontend captures your stdout directly; persisting the file is its job.`;

function technicalOutputRules(allowRead: boolean): string {
  return `
You are a world-class visual designer and senior frontend engineer. Produce a **self-contained single-file HTML document**.

[CONTENT DRIVES QUANTITY — HIGHEST PRIORITY, OVERRIDES ANY NUMBER IN THE TEMPLATE]
- The template defines the available layouts, style, palette, typography and component vocabulary. It does **not** define how many slides, frames, cards or sections to emit.
- That count follows entirely from the length and information structure of the user content. Cover **every** point, section and data group — never summarise, compress or drop information.
- Any count in the template body ("6-10 slides", "3-6 cards") is a reference floor for a short input, not a ceiling. Long input should go well past it.
- A list of layouts is a **reusable pool**: the same layout may appear many times carrying different data. It is not a page limit.
- Method: split the user content semantically (headings, claims, data groups, list items, steps), give each piece at least one section, then pick the best-fitting layout from the pool. Prefer more sections over cramming unrelated points into one.

[HARD TECHNICAL REQUIREMENTS]
${allowRead ? FS_RULE_READ_ALLOWED : FS_RULE_STRICT}
- Stream the complete HTML document as the body of your reply. Do not preface it with "I'll generate…" or "Written to…".
- The document starts with \`<!DOCTYPE html>\` and ends with \`</html>\`.
- In \`<head>\`, load Tailwind v3 Play (https://cdn.tailwindcss.com) and any fonts you need from a CDN.
- Do not reference external image URLs unless you can guarantee they stay valid; prefer inline CSS / SVG.
- Load any scripts you need (charts, animation) from jsdelivr; the file must work when opened directly.
- Output **pure HTML** — no markdown code fence, no explanatory prose. The first character must be \`<\`.
`;
}

/** Default technical rules — English, filesystem access fully denied. */
export const TECHNICAL_OUTPUT_RULES = technicalOutputRules(false);

/** The house design brief. Skipped by skills that own their own design language. */
export const VISUAL_DESIGN_DIRECTIVES = `
[DESIGN GUIDELINES — WORLD-CLASS STANDARD]
- Typography: \`Inter\` / \`Manrope\` / \`SF Pro\`-style Latin stacks, with \`Noto Sans SC\` / \`Noto Serif SC\` alongside when the content is Chinese.
- Colour: 1 primary colour + 2 neutrals + at most 1 accent; generous whitespace; avoid pure black / pure white (#000/#fff) — use \`#0a0a0a\` / \`#fafafa\` instead.
- Grid: 8 px baseline; paragraphs max-width 65 ch; clear hierarchy between headings and body text.
- Micro detail: consistent radii (rounded-xl/2xl), soft shadows (shadow-sm/lg), 1px borders \`#e5e7eb\` / \`#262626\`.
- Motion: use \`transition-all\` or an entrance fade-in only where needed; never let it overpower the content.
- Accessibility: colour contrast ≥ 4.5; every important interaction has a visible focus state.

[CONTENT AUTHENTICITY]
- **Always use the user's real data** — never invent it, never lorem ipsum, never "Your text here".
- If the user data is structured (CSV/JSON), extract the key insights and present them as charts / tables.

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
  /** Accepted for backward compatibility — the preamble is always English. */
  language?: PromptLanguage;
}): string {
  const technical = technicalOutputRules(opts.allowRead === true);
  const visual = opts.designDirectives === "none" ? "" : VISUAL_DESIGN_DIRECTIVES;
  return `${technical}${visual}
${opts.body.trim()}

[INPUT FORMAT]: ${opts.format}
[USER CONTENT]:
${opts.content}
`;
}
