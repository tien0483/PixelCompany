import { describe, expect, it } from "vitest";

import { buildDiffEditPrompt, buildEditPrompt } from "../build-edit-prompt";

const OLD_HTML = "<html><head><title>Deck</title></head><body>Q2 revenue: 1.2M</body></html>";

const DIFF = ["@@ -3,3 +3,3 @@", " ## Numbers", "-Q2 revenue: 1.2M", "+Q2 revenue: 1.4M"].join("\n");

describe("buildDiffEditPrompt", () => {
  it("carries the diff and the existing HTML, and never the full requirement", () => {
    const prompt = buildDiffEditPrompt({
      templateName: "仪表板",
      templateAspect: "16:9",
      diff: DIFF,
      oldHtml: OLD_HTML,
      format: "markdown",
    });

    expect(prompt).toContain("[REQUIREMENT DIFF");
    expect(prompt).toContain("+Q2 revenue: 1.4M");
    expect(prompt).toContain(OLD_HTML);
    // The two-full-documents payload belongs to the fallback path only.
    expect(prompt).not.toContain("[OLD CONTENT]");
    expect(prompt).not.toContain("[NEW CONTENT]");
  });

  it("keeps the head/structure preservation rules the full-content edit prompt has", () => {
    const prompt = buildDiffEditPrompt({
      templateName: "仪表板",
      templateAspect: "16:9",
      diff: DIFF,
      oldHtml: OLD_HTML,
      format: "markdown",
    });

    expect(prompt).toContain("minimal diff-edit");
    expect(prompt).toContain("The first character must be");
    expect(prompt).toContain("Do NOT use file tools");
    expect(prompt).toContain("must come back byte-identical");
  });
});

describe("buildEditPrompt", () => {
  it("still sends both versions of the requirement when no diff is available", () => {
    const prompt = buildEditPrompt({
      templateName: "仪表板",
      templateAspect: "16:9",
      newContent: "Q2 revenue: 1.4M",
      oldContent: "Q2 revenue: 1.2M",
      oldHtml: OLD_HTML,
      format: "markdown",
    });

    expect(prompt).toContain("[OLD CONTENT]");
    expect(prompt).toContain("[NEW CONTENT]");
    expect(prompt).toContain(OLD_HTML);
  });
});
