import { describe, expect, it } from "vitest";

import { loadSkill } from "../loader";
import {
  SHARED_DESIGN_DIRECTIVES,
  TECHNICAL_OUTPUT_RULES,
  VISUAL_DESIGN_DIRECTIVES,
  assemblePrompt,
} from "../shared";

/**
 * The preamble knobs (`design_directives`, `prompt_language`, `allow_read`) are
 * additive: a skill that sets none of them must get the exact prompt it got
 * before they existed. The Papp skills need the opposite of every default, so
 * they double as the fixture proving the frontmatter actually parses.
 */

const OPTS = { body: "  TEMPLATE BODY  ", content: "USER CONTENT", format: "markdown" };

describe("assemblePrompt", () => {
  it("defaults to the untouched Chinese preamble with filesystem access denied", () => {
    const prompt = assemblePrompt(OPTS);
    expect(prompt).toContain(SHARED_DESIGN_DIRECTIVES);
    expect(prompt).toContain("禁止使用 Write / Edit / MultiEdit / Bash / Create / 任何文件系统工具");
    expect(prompt).toContain("【输入格式】: markdown");
    expect(prompt).toContain("【用户内容】:\nUSER CONTENT");
    expect(prompt).toContain("TEMPLATE BODY");
    // body is trimmed, not padded through
    expect(prompt).not.toContain("  TEMPLATE BODY  ");
  });

  it("drops only the house design brief for design_directives: none", () => {
    const prompt = assemblePrompt({ ...OPTS, designDirectives: "none" });
    expect(prompt).not.toContain(VISUAL_DESIGN_DIRECTIVES.trim());
    expect(prompt).not.toContain("盘古之白");
    // the pipeline contract survives — the stream parser depends on it
    expect(prompt).toContain(TECHNICAL_OUTPUT_RULES.trim());
    expect(prompt).toContain("第一个字符必须是");
  });

  it("swaps the filesystem paragraph when allowRead is set", () => {
    const prompt = assemblePrompt({ ...OPTS, allowRead: true });
    expect(prompt).toContain("允许使用 Read / Glob");
    expect(prompt).not.toContain("禁止使用 Write / Edit / MultiEdit / Bash / Create / 任何文件系统工具");
    // writing HTML to disk stays banned in both variants
    expect(prompt).toContain("Write / Edit / MultiEdit / Bash / Create");
  });

  it("emits an English preamble and English labels for language: en", () => {
    const prompt = assemblePrompt({ ...OPTS, language: "en", designDirectives: "none" });
    expect(prompt).toContain("CONTENT DRIVES QUANTITY");
    expect(prompt).toContain("HARD TECHNICAL REQUIREMENTS");
    expect(prompt).toContain("The first character must be");
    expect(prompt).toContain("[INPUT FORMAT]: markdown");
    expect(prompt).toContain("[USER CONTENT]:\nUSER CONTENT");
    expect(prompt).not.toContain("【用户内容】");
  });

  it("combines English with allowRead", () => {
    const prompt = assemblePrompt({ ...OPTS, language: "en", allowRead: true });
    expect(prompt).toContain("**Read / Glob are ALLOWED**");
    expect(prompt).not.toContain("Do NOT use Write / Edit / MultiEdit / Bash / Create or any filesystem tool.");
  });
});

describe("Papp skill frontmatter", () => {
  const ids = ["papp-overview", "papp-monitoring", "papp-status-grid"];

  it.each(ids)("%s opts out of the house brief, reads files and speaks English", (id) => {
    const skill = loadSkill(id);
    expect(skill).not.toBeNull();
    expect(skill?.designDirectives).toBe("none");
    expect(skill?.language).toBe("en");
    expect(skill?.allowRead).toBe(true);
    expect(skill?.body).toContain("Build blueprint");
  });

  it("leaves an untouched bundled skill on every default", () => {
    const skill = loadSkill("dashboard");
    expect(skill).not.toBeNull();
    expect(skill?.designDirectives).toBe("default");
    expect(skill?.language).toBe("zh");
    expect(skill?.allowRead).toBe(false);
  });
});
