import fs from "node:fs";
import path from "node:path";

/**
 * Template skills used to be read from `path.join(process.cwd(), "src/lib/templates/skills")`,
 * which silently broke whenever the Next server was started from anywhere but its own
 * package dir. They now live in the monorepo's single agent-data root, alongside the
 * Manager catalog, and are resolved rather than hardcoded.
 *
 * Strategy mirrors `backends/manager/manager/data_paths.py`: env override, then a walk
 * up the parents looking for `agent-data/manifest.json`, then the pre-move location so
 * an un-migrated checkout still renders. Duplicated in each backend on purpose — a
 * shared workspace package would need a new `package.json`.
 */

const AGENT_DATA_ENV = "PIXELOFFICE_AGENT_DATA";
const MAX_PARENT_WALK_DEPTH = 10;

function walkParents(start: string): string[] {
  const roots: string[] = [];
  let current = path.resolve(start);
  for (let depth = 0; depth < MAX_PARENT_WALK_DEPTH; depth += 1) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

/** Absolute path to `<repo>/agent-data`, or `null` when no manifest is reachable. */
export function findAgentDataRoot(): string | null {
  const override = process.env[AGENT_DATA_ENV]?.trim();
  if (override) {
    return fs.existsSync(path.join(override, "manifest.json")) ? path.resolve(override) : null;
  }
  for (const base of walkStarts().flatMap(walkParents)) {
    const candidate = path.join(base, "agent-data");
    if (fs.existsSync(path.join(candidate, "manifest.json"))) return candidate;
  }
  return null;
}

/**
 * `__dirname` covers a server bundle running from `.next/`; `process.cwd()` covers a
 * dev server or test run. `__dirname` is absent under a pure-ESM loader, so it is
 * feature-detected rather than assumed.
 */
function walkStarts(): string[] {
  const here = typeof __dirname === "string" ? __dirname : null;
  return here === null ? [process.cwd()] : [here, process.cwd()];
}

/** Directory holding this backend's template skills. */
export function templateSkillsDir(): string {
  const agentDataRoot = findAgentDataRoot();
  if (agentDataRoot !== null) {
    const candidate = path.join(agentDataRoot, "templates", "skills");
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(process.cwd(), "src/lib/templates/skills");
}
