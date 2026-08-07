import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findAgentDataRoot, templateSkillsDir } from "@/lib/agent-data-root";

describe("agent-data root resolution", () => {
  it("finds the monorepo agent-data root", () => {
    const root = findAgentDataRoot();
    expect(root).not.toBeNull();
    expect(fs.existsSync(path.join(root as string, "manifest.json"))).toBe(true);
  });

  it("resolves template skills to agent-data/templates/skills", () => {
    const dir = templateSkillsDir();
    expect(dir.replace(/\\/g, "/")).toContain("agent-data/templates/skills");
    // The picker renders whatever is here; an empty dir is the failure mode the
    // old `process.cwd()` join produced whenever the server started elsewhere.
    expect(fs.readdirSync(dir).length).toBeGreaterThan(50);
  });

  it("honours the PIXELOFFICE_AGENT_DATA override", () => {
    const previous = process.env.PIXELOFFICE_AGENT_DATA;
    process.env.PIXELOFFICE_AGENT_DATA = path.join(__dirname, "does-not-exist");
    try {
      expect(findAgentDataRoot()).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.PIXELOFFICE_AGENT_DATA;
      else process.env.PIXELOFFICE_AGENT_DATA = previous;
    }
  });
});
