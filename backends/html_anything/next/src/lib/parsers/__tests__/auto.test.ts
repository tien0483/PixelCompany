import { describe, expect, it } from "vitest";

import { detectFormat, summarizeForAgent } from "../auto";

describe("PDF summaries", () => {
  it("detects extracted PDF markdown as pdf content", () => {
    const input = [
      "# PDF: paper.pdf",
      "",
      "Source: PDF",
      "Pages: 2",
      "Extraction: embedded text",
      "",
      "## Page 1",
      "First page",
    ].join("\n");

    expect(detectFormat(input)).toBe("pdf");

    const summary = summarizeForAgent(input);
    expect(summary.format).toBe("pdf");
    expect(summary.preview).toBe("[PDF document, 2 pages, 86 chars, extraction: embedded text]");
  });
});
