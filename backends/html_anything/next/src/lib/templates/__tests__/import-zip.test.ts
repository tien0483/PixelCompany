import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importTemplateZip, sanitizeTemplateId, TemplateImportError } from "../import-zip";

const SKILL_MD = [
  "---",
  'en_name: "Papp Rollup"',
  'zh_name: "汇总"',
  'emoji: "📊"',
  'description: "Weekly rollup"',
  "---",
  "",
  "Render the rollup.",
].join("\n");

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [entryPath, content] of Object.entries(files)) {
    zip.file(entryPath, content);
  }
  return await zip.generateAsync({ type: "nodebuffer" });
}

let skillsDir: string;

beforeEach(async () => {
  skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), "ha-template-import-"));
});

afterEach(async () => {
  await fs.rm(skillsDir, { recursive: true, force: true });
});

async function read(id: string, file: string): Promise<string> {
  return await fs.readFile(path.join(skillsDir, id, file), "utf8");
}

describe("importTemplateZip", () => {
  it("installs a template whose files sit at the archive root", async () => {
    const result = await importTemplateZip(
      await zipOf({ "SKILL.md": SKILL_MD, "example.md": "# Sample", "example.html": "<h1>Sample</h1>" }),
      { skillsDir },
    );

    expect(result).toMatchObject({ id: "papp-rollup", replaced: false });
    expect(result.files.sort()).toEqual(["SKILL.md", "example.html", "example.md"]);
    expect(await read("papp-rollup", "SKILL.md")).toBe(SKILL_MD);
    expect(await read("papp-rollup", "example.html")).toBe("<h1>Sample</h1>");
  });

  it("strips a single wrapping folder and falls back to its name for the id", async () => {
    const noName = SKILL_MD.replace('en_name: "Papp Rollup"', 'description: "no names here"').replace(
      'zh_name: "汇总"',
      "",
    );
    const result = await importTemplateZip(
      await zipOf({ "My Deck/SKILL.md": noName, "My Deck/example.html": "<h1>Deck</h1>" }),
      { skillsDir },
    );

    expect(result.id).toBe("my-deck");
    expect(await read("my-deck", "example.html")).toBe("<h1>Deck</h1>");
  });

  it("replaces an existing template of the same id atomically", async () => {
    await importTemplateZip(await zipOf({ "SKILL.md": SKILL_MD, "example.html": "<h1>v1</h1>" }), { skillsDir });
    const second = await importTemplateZip(await zipOf({ "SKILL.md": SKILL_MD, "example.html": "<h1>v2</h1>" }), {
      skillsDir,
    });

    expect(second.replaced).toBe(true);
    expect(await read("papp-rollup", "example.html")).toBe("<h1>v2</h1>");
    // The staged and backup directories must not survive the swap.
    const leftovers = (await fs.readdir(skillsDir)).filter((entry) => entry.startsWith("."));
    expect(leftovers).toEqual([]);
  });

  it("ignores archive cruft and files buried deeper than one folder", async () => {
    await expect(
      importTemplateZip(await zipOf({ "docs/examples/SKILL.md": SKILL_MD, "__MACOSX/._SKILL.md": "junk" }), {
        skillsDir,
      }),
    ).rejects.toMatchObject({ code: "skill_md_missing" });
  });

  it("rejects an archive with no SKILL.md", async () => {
    await expect(
      importTemplateZip(await zipOf({ "example.html": "<h1>orphan</h1>" }), { skillsDir }),
    ).rejects.toBeInstanceOf(TemplateImportError);
  });

  it("rejects a SKILL.md with no frontmatter", async () => {
    await expect(
      importTemplateZip(await zipOf({ "SKILL.md": "Just prose, no frontmatter." }), {
        skillsDir,
        fileName: "loose.zip",
      }),
    ).rejects.toMatchObject({ code: "skill_md_no_frontmatter" });
  });

  it("rejects a traversal entry instead of writing outside the templates dir", async () => {
    await expect(
      importTemplateZip(await zipOf({ "../evil/SKILL.md": SKILL_MD }), { skillsDir }),
    ).rejects.toMatchObject({ code: "unsafe_path" });
  });

  it("rejects an entry that decompresses past its cap", async () => {
    const huge = `${SKILL_MD}\n${"x".repeat(300 * 1024)}`;
    await expect(importTemplateZip(await zipOf({ "SKILL.md": huge }), { skillsDir })).rejects.toMatchObject({
      code: "entry_too_large",
    });
  });

  it("rejects a file that is not a zip at all", async () => {
    await expect(importTemplateZip(Buffer.from("not a zip"), { skillsDir })).rejects.toMatchObject({
      code: "archive_unreadable",
    });
  });

  it("leaves nothing behind when the archive is refused", async () => {
    await expect(importTemplateZip(Buffer.from("not a zip"), { skillsDir })).rejects.toThrow();
    expect(await fs.readdir(skillsDir)).toEqual([]);
  });
});

describe("sanitizeTemplateId", () => {
  it("produces ids the loader's own folder-name check accepts", () => {
    for (const input of ["Papp Rollup", "papp_rollup.zip", "  Weekly Update  ", "deck--swiss"]) {
      const id = sanitizeTemplateId(input);
      expect(id).not.toBeNull();
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("returns null when nothing usable is left", () => {
    expect(sanitizeTemplateId("...")).toBeNull();
    expect(sanitizeTemplateId("")).toBeNull();
  });
});
