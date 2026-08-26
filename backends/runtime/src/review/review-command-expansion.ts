/**
 * The panel's own review commands, expanded here instead of by the CLI.
 *
 * Until now the reviewer's text was passed to `claude -p` verbatim and the CLI
 * expanded whatever it recognized. That works for a command belonging to the
 * checkout, and it cannot work for the built-in review commands, because all of
 * them resolve against the *working tree* while the panel's subject — a merge
 * request branch nobody has checked out — exists only in the prompt:
 *
 * - `/understand-diff` was an agent-stack skill. The chat runs with the reviewed
 *   project as cwd, and that checkout does not ship it, so the CLI answered
 *   `Unknown command: /understand-diff` and the turn produced nothing.
 * - `/security-review` is defined as "the pending changes on the current branch".
 *   With the branch unfetched, `git status` is clean, so it reported "No changes to
 *   review" and asked for a checkout of a diff already in its context.
 * - `/code-review` widened to the whole branch diff, ignoring the file and the lines
 *   on screen. On a large merge request that is what tripped the upstream rate limit.
 *
 * So they become locally-authored instructions built from context the panel already
 * has, and the prompt no longer starts with a slash — nothing is left for the CLI to
 * expand. `/simplify` is deliberately absent: it is a built-in skill that reads the
 * code it is given and already honours the selection. A project's own commands from
 * `.claude/commands` are absent too — those are real commands in that checkout,
 * written by that team, and expanding them locally would override their process.
 *
 * ## Scope is the organizing idea
 *
 * Two of these are wired to buttons rather than chips, because they read every patch
 * in the merge request and cost accordingly. The chips are scoped to the file or the
 * lines on screen. `/security-review` is the deliberate exception — an injection is
 * often only visible once you can see both the sink and the entry point — so it is a
 * chip with merge-request scope, and the reviewer pays for that when they run it.
 */

/** Whether an expansion reads the whole merge request or only what is on screen. */
export type ReviewCommandScope = "screen" | "merge-request";

/**
 * The two commands the panel's buttons send. Exported so the frontend and the tests
 * name them once. The composer keeps its own copy of the merge-request-scoped list
 * (it decides whether to attach every patch to the request); the two must stay in
 * step, and `review-chat-composer.tsx` says so at that copy.
 */
export const REVIEW_UNDERSTAND_CHANGES_COMMAND = "/understand-changes";
export const REVIEW_CODE_REVIEW_DIFF_COMMAND = "/code-review-diff";

export interface ReviewCommandExpansion {
	/** The command as matched, for logging and tests. */
	command: string;
	/** Replaces the reviewer's text as the opening of the chat prompt. */
	text: string;
	scope: ReviewCommandScope;
	/**
	 * True when the answer is supposed to be read off the knowledge-graph brief, so
	 * the brief has to be in *this* turn's prompt rather than merely somewhere in the
	 * session. A `/security-review` on the sixth message would otherwise be judged
	 * against a walk done for whichever file was on screen at the first one.
	 */
	needsGraphImpact: boolean;
	/** True when the project's extracted rules bundle belongs in the prompt. */
	needsRules: boolean;
}

interface ExpansionSpec {
	scope: ReviewCommandScope;
	needsGraphImpact: boolean;
	needsRules: boolean;
	build: (input: { hasGraphImpact: boolean; hasRules: boolean }) => string;
}

/**
 * The shared constraint. Every one of these commands failed, in its own way, by
 * going to git for the change instead of reading the change it was handed.
 */
const NO_CHECKOUT_RULE = `The merge request branch is NOT checked out in the working directory. The patches in the context below are the whole change, and git cannot show you more of it: do not run \`git diff\`/\`git status\`/\`git log\` to find the changes, do not ask for the branch to be checked out, and never answer "no changes to review" — the change is what you were given.`;

const UNDERSTAND_CHANGES: ExpansionSpec = {
	scope: "merge-request",
	needsGraphImpact: true,
	needsRules: false,
	build: ({ hasGraphImpact }) => {
		// Graph first, grep only for what the graph missed. The button used to order a
		// repository-wide grep "without relying on any pre-built knowledge graph" — the
		// most expensive thing in the panel, for an answer the runtime computes for free
		// in TypeScript before the prompt is even sent.
		const source = hasGraphImpact
			? `Start from the "Knowledge-graph impact" section below. It is a finished one-hop walk of this project's Understand Anything graph over every changed path, computed before this prompt was sent, and it is the bulk of the answer. Do not re-derive it: no repository-wide grep for callers, and never read \`.ua/knowledge-graph.json\` — it is tens of megabytes.

The brief names the changed paths the graph has no node for. Those, and only those, are worth searching for by hand: for each one, Grep its filename and then the names the diff adds or changes. Say which paths you grepped and why, so the reviewer can tell the graph's answer from yours.`
			: `There is no knowledge-graph brief in your context — either this project has never been analyzed, or the graph has no node for any changed path. Say that in one line, then fall back to searching: for each changed file, Grep its filename and the names the diff adds or changes to find importers and callers. Never read \`.ua/knowledge-graph.json\` directly.`;

		return `Tell the reviewer what this merge request touches and what could break because of it. This one covers the whole merge request, not the file on screen.

${source}

${NO_CHECKOUT_RULE}

Then answer, in this order:

- what the change does, grouped by area, in a few sentences read off the patches;
- what depends on it and therefore has to be checked — each named by path, each labelled breaking, additive or internal *for that dependent*;
- what is still unknown, including anything neither the graph nor a search covered.

A dependent is a place to look, not a defect. Write "\`x.py\` imports this", never "this breaks \`x.py\`", unless you have actually read \`x.py\` in this turn.`;
	},
};

const CODE_REVIEW_DIFF: ExpansionSpec = {
	scope: "merge-request",
	needsGraphImpact: true,
	needsRules: true,
	build: ({ hasGraphImpact, hasRules }) => {
		// The rules bundle is the project's own extracted guidelines. When it exists it
		// outranks taste, and when it does not the pass must not invent a house style —
		// a fabricated convention in a review comment is worse than no comment.
		const rulesClause = hasRules
			? `The "Team rules" section below was extracted from this project's own guideline documents and lint configuration. Check against it first, and cite the rule id in any finding it covers: a citation the author can trace beats a matter of taste. Rules are not the whole review — a correctness bug no rule mentions is still the most important thing you can find.`
			: `No rules bundle exists for this project, so there is no house style to check against. Review on ordinary correctness and craft grounds and do not invent a convention — a fabricated house rule in a review comment costs the reviewer their credibility.`;

		const graphClause = hasGraphImpact
			? `Use the "Knowledge-graph impact" section for blast radius: it names what depends on the changed code, which is how you judge whether a signature change or a behaviour change is safe. Cite the dependent by path when it changes your severity. It is not evidence on its own — a dependent you have not read cannot be reported as broken.`
			: `No knowledge-graph brief is in your context, so you cannot see what depends on this code. Judge severity from the patches alone and say so where it matters.`;

		return `Review this merge request as a senior code reviewer and give the human reviewer a verdict they can act on. Read every patch below; this pass is the whole merge request, and it is also *only* the diff.

${NO_CHECKOUT_RULE}

Scope. This is the substance of the request, not preamble — a review that widens is how a diff-scoped request turns into a whole-file audit reporting problems the author never touched:

- Read the patches below and nothing else. Do not read a changed file at its full content, do not go exploring unchanged files, and do not follow an import to see what is on the other side.
- Report problems only on lines this merge request added or modified. A pre-existing problem on an untouched line is out of scope even when a hunk puts it on screen — mention it in one line if it is severe, but do not raise it as a finding against this change.
- When a hunk cannot be judged without context the patches do not contain, say so and name what you would need. Do not guess, and do not fetch it.

${rulesClause}

${graphClause}

What to check, in this order:

- **Correctness** — logic that does not match the surrounding code's contract, boundary and off-by-one handling, error and null/None paths, resource lifetimes, concurrency assumptions, a broken invariant, a leaked resource.
- **Security** — untrusted input reaching a query, command, path or template; a secret in the diff; an authorization check the change moves, weakens or skips. Keep it short; the real security pass is its own command.
- **Contract breaks** — a signature, return shape, raised error or default the diff changes without updating what depends on it. Name the dependents you can see in the patches or in the graph section; do not sweep the repository for more.
- **Intent** — does the change do what its title says, and is anything half-done or left inconsistent between files?
- **Design** — separation of concerns, error handling, type safety, duplication now worth extracting (and abstraction not yet earned).
- **Tests** — where the diff changes behaviour and touches tests, do those tests assert real behaviour rather than restate the implementation? Do not report missing coverage as a finding.

Skip: formatting, naming preferences, anything a linter or typechecker would catch, and speculative "this could be refactored" notes.

Output, in this order:

### Strengths

Two or three specific lines. Skip it if there is genuinely nothing to say — do not pad.

### Critical

Bugs, data loss, security, broken functionality. Empty if there are none.

### Important

Design problems, missing cases, poor error handling, test gaps.

### Minor

Style, naming, small clean-ups.

### Verdict

Ready to merge: yes / no / with fixes — plus one or two sentences of reasoning.

Every finding: \`path:line\`, what is wrong, why it matters, and the fix when it is not obvious. Calibrate honestly — a nitpick in Critical costs you the reviewer's trust in the whole report. Never comment on code you were not shown; the patches below are what you read.`;
	},
};

const SECURITY_REVIEW: ExpansionSpec = {
	// The chip that deliberately reads the whole merge request: a sink in one file and
	// the entry point that reaches it in another are one finding, and a screen-scoped
	// pass sees at most half of it.
	scope: "merge-request",
	needsGraphImpact: true,
	needsRules: false,
	build: ({ hasGraphImpact }) => {
		const reachability = hasGraphImpact
			? `2. The "Knowledge-graph impact" section, for *reachability*. Whether a changed function is reached from a request handler, a CLI entry point, or only from a test is what decides whether unvalidated input here is exploitable or inert.`
			: `2. No knowledge-graph brief is in your context, so you cannot establish reachability. Say so once, and judge each finding on the patches alone.`;

		return `Do a security pass over this merge request. Read every patch below — a sink and the entry point that reaches it are often in different files, which is why this one is not scoped to the screen.

${NO_CHECKOUT_RULE}

Scope, in this order:

1. The patches. Every finding must be anchored to a line in one of them.
${reachability}
3. At most a few targeted \`Read\` calls, each to confirm one specific hypothesis about one file named above. No repository-wide grep, no sweep for other instances of the same pattern, no reading the graph file.

What to look for: injection (SQL, shell, path traversal), deserialization or eval of untrusted input, authentication and authorization checks the change moves, weakens or skips, secrets and credentials in the diff, unsafe defaults, missing validation where data crosses a trust boundary, and resource exhaustion reachable from an entry point.

An inference is allowed here and is often the most useful thing you can produce — but label it as one: "if \`api/routes.py\` reaches this with a user-supplied \`path\`, this is a traversal; the graph shows that edge, I have not read the caller". Never present an unread caller as a confirmed exploit path, and do not pad: "nothing security-relevant in this change" is a valid result.`;
	},
};

const CODE_REVIEW: ExpansionSpec = {
	scope: "screen",
	needsGraphImpact: false,
	needsRules: false,
	build: () => `Review the code the reviewer is looking at, for correctness.

Scope is what the context below contains and nothing else: the selected lines when a selection is present, otherwise the diff of the file on screen. Do not review the whole merge request, do not widen the diff, and do not walk the other changed files — the changed-file list is there for orientation, not as a work list. The reviewer has a button for the whole-merge-request review and did not press it.

${NO_CHECKOUT_RULE}

Look for: logic that does not do what the surrounding code implies, boundary and off-by-one handling, error and null/None paths, resource lifetimes, concurrency assumptions, and behaviour changes this makes for existing callers (the "Knowledge-graph impact" section, when present, names them).

Report only what these lines show. "Nothing wrong in these lines" is a valid and useful answer; a padded list is not.`,
};

/**
 * Keyed by the command the reviewer types or the button sends. `/understand-diff`
 * is kept as an alias of the button's command rather than removed: the chip for it
 * is gone, but a reviewer who types it from muscle memory should get the answer, not
 * `Unknown command` — and having two scopes behind one question is the confusion
 * this whole module exists to end.
 */
const REVIEW_COMMAND_EXPANSIONS: ReadonlyMap<string, ExpansionSpec> = new Map([
	[REVIEW_UNDERSTAND_CHANGES_COMMAND, UNDERSTAND_CHANGES],
	["/understand-diff", UNDERSTAND_CHANGES],
	[REVIEW_CODE_REVIEW_DIFF_COMMAND, CODE_REVIEW_DIFF],
	["/security-review", SECURITY_REVIEW],
	// `/code-review` cannot swallow `/code-review-diff`: the match below requires the
	// command to be the whole text or to be followed by a space.
	["/code-review", CODE_REVIEW],
]);

function matchReviewCommand(prompt: string): { command: string; spec: ExpansionSpec; argument: string } | null {
	const trimmed = prompt.trimStart();
	for (const [command, spec] of REVIEW_COMMAND_EXPANSIONS) {
		if (trimmed === command || trimmed.startsWith(`${command} `)) {
			return { command, spec, argument: trimmed.slice(command.length).trim() };
		}
	}
	return null;
}

/**
 * Null means "send the reviewer's text as they wrote it" — a question, `/simplify`,
 * or one of the project's own commands.
 */
export function expandReviewCommand(
	prompt: string,
	options: { hasGraphImpact: boolean; hasRules: boolean },
): ReviewCommandExpansion | null {
	const matched = matchReviewCommand(prompt);
	if (matched === null) {
		return null;
	}
	const base = matched.spec.build({ hasGraphImpact: options.hasGraphImpact, hasRules: options.hasRules });
	// The reviewer's own words come last and are given priority on purpose: they typed
	// them after picking the chip, so they are narrowing the canned instruction — and
	// the chip is prefilled rather than sent precisely so that they can.
	const text =
		matched.argument.length > 0
			? `${base}\n\nThe reviewer added this, and it narrows the request above — follow it where the two differ:\n\n${matched.argument}`
			: base;
	return {
		command: matched.command,
		text,
		scope: matched.spec.scope,
		needsGraphImpact: matched.spec.needsGraphImpact,
		needsRules: matched.spec.needsRules,
	};
}

/**
 * Whether this turn needs a freshly-computed graph brief even though it is not the
 * first. Called by the routes, which decide whether to spend the walk before the
 * prompt is built. The walk is deterministic TypeScript over an already-loaded
 * index, so this costs no model tokens — only the prompt characters of the brief.
 */
export function reviewCommandNeedsGraphImpact(prompt: string): boolean {
	return matchReviewCommand(prompt)?.spec.needsGraphImpact ?? false;
}

/** Whether the route should read the project's rules bundle for this turn. */
export function reviewCommandNeedsRules(prompt: string): boolean {
	return matchReviewCommand(prompt)?.spec.needsRules ?? false;
}

/**
 * `null` for anything this module does not expand. The frontend has its own copy of
 * the merge-request-scoped names, because it has to decide whether to put every
 * patch on the request before the runtime ever sees the prompt.
 */
export function reviewCommandScope(prompt: string): ReviewCommandScope | null {
	return matchReviewCommand(prompt)?.spec.scope ?? null;
}

/** True for any command this module expands locally rather than passing to the CLI. */
export function isExpandedReviewCommand(prompt: string): boolean {
	return matchReviewCommand(prompt) !== null;
}
