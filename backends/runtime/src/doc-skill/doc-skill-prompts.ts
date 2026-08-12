// Prompt builders for the one-shot docs-pipeline agent.
//
// A one-shot `claude -p` run has no skill-loading mechanism, so the rules
// that would normally live in a SKILL.md the agent discovers on its own
// instead have to travel as prompt text: both builders below embed the
// vendored skill's Markdown verbatim, then append concrete task instructions.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SKILL_MD_RELATIVE_PATH = "skills/harness_doc_site/SKILL.md";
const WORKFLOW_MD_RELATIVE_PATH = "skills/harness_doc_site/references/workflow.md";

export interface DocSkillText {
	skillMd: string;
	workflowMd: string;
}

/**
 * Reads the two Markdown files the one-shot agent needs embedded in its
 * prompt. Returns `null` (never throws) when either file is missing, so
 * callers can treat "prompts unavailable" the same never-fatal way every
 * other optional subsystem in this codebase does.
 */
export function loadDocSkillText(docSkillRoot: string): DocSkillText | null {
	try {
		const skillMd = readFileSync(join(docSkillRoot, SKILL_MD_RELATIVE_PATH), "utf8");
		const workflowMd = readFileSync(join(docSkillRoot, WORKFLOW_MD_RELATIVE_PATH), "utf8");
		return { skillMd, workflowMd };
	} catch {
		return null;
	}
}

export function buildDocAuditPrompt(input: {
	skillText: DocSkillText;
	targetRepo: string;
	workspaceDir: string;
	focus?: string;
}): string {
	const focusLine = input.focus ? `Focus your investigation on: ${input.focus}\n\n` : "";
	return `${input.skillText.skillMd}

---

${input.skillText.workflowMd}

---

# Your task: documentation audit

Your job is a read-only investigation of the codebase at \`${input.targetRepo}\`. ${focusLine}Produce exactly ONE new markdown file named \`NN_audit_<short-topic>.md\` — pick the next available \`NN\` and a short topic slug yourself — and write it into the workspace directory \`${input.workspaceDir}\`.

Follow the audit format described above: a per-plan-row table with a \`PRESENT\`/\`PARTIAL\`/\`ABSENT\` status for each row. Every status claim must carry a \`file:line\` citation — this is the skill's core invariant, do not skip it for any row.

After writing the audit doc, add it to the \`docs\` array in \`${input.workspaceDir}/site.json\`. That array is a list of 3-element arrays \`[htmlFilename, label, mdFilename]\`, e.g.:

    ["doc_01_audit_topic.html", "Audit: Topic", "01_audit_topic.md"]

Read the existing \`site.json\` first and append to it — do not overwrite the array or drop existing entries.

Do not run \`build_site.py\` yourself; the caller builds separately. Do not modify any file outside \`${input.workspaceDir}\` — you have \`Write\`/\`Edit\` access but must stay inside the doc workspace — and do not modify anything under \`skills/\` (read-only reference material).
`;
}

export function buildDocRoundPrompt(input: {
	skillText: DocSkillText;
	targetRepo: string;
	workspaceDir: string;
}): string {
	return `${input.skillText.skillMd}

---

${input.skillText.workflowMd}

---

# Your task: harness round

Your job is to re-verify existing claims in \`${input.workspaceDir}\` against the current state of the code at \`${input.targetRepo}\` — a harness round, per the workflow above.

1. Read \`${input.workspaceDir}/verdicts.json\` and the existing doc markdown files in \`${input.workspaceDir}\` to see what claims already exist.
2. For each claim, check whether it is still true by reading the cited \`file:line\` locations in \`${input.targetRepo}\`.
3. Run (using the full path — do not \`cd\` first, the tool grant is scoped to \`python3\` invocations only):

       python3 ${input.workspaceDir}/round_tool.py open --at <today's date> --trigger "<one line: what prompted this round>"

   Then, for each claim, run:

       python3 ${input.workspaceDir}/round_tool.py check --doc <file> --match "<heading>" --verdict <CONFIRMED|STALE|WRONG|ADDED|SCOPE> --now "<current true statement>" [--target "..."] --by "<its own identifier, e.g. 'automated round'>"

Never edit the markdown docs directly to "fix" a stale claim — corrections happen ONLY through \`round_tool.py check\`, which is append-only. This is a hard invariant from the embedded skill text above; violating it destroys the dated history the harness depends on.
`;
}
