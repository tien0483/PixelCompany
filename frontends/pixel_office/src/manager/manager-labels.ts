/**
 * User-visible copy for the Manager surface — the office-staffing framing over the
 * Manager integration.
 *
 * Naming split, on purpose: files, types, tRPC procedures and test ids keep the
 * `jacked` name so they stay traceable to the upstream Manager API they wrap,
 * while everything a person reads says Manager. Retheming later means editing this
 * file, not hunting literals across the views.
 */
export const MANAGER_LABELS = {
	/** Left-sidebar tab and section heading. */
	section: "Manager",
	/** Upper-right home pane: Claude accounts and their usage meters. */
	seats: "Seats",
	offline: "Manager offline",
	offlineHint: "Accounts appear when the companion is running.",
	configDisabled: "Manager offline — config disabled",
	installationsOfflineHint: "Installations require the Manager companion.",
	metersStale: "Manager unreachable (cached)",
	refreshAllUsage: "Refresh all usage",
	routes: {
		agents: "Agents",
		commands: "Commands",
		skills: "Skills",
		rules: "Rules & Reference",
		workflows: "Workflows",
		installations: "Installations",
		settings: "Settings",
		logs: "Logs",
		analytics: "Analytics",
	},
	/** Shown once per shelf: installing writes into the user's global ~/.claude. */
	globalInstallNotice: "Hiring and training write into your global ~/.claude, for every project.",
	shelves: {
		agents: {
			title: "Agents",
			description: "Specialist subagents you can put on the payroll — reviewers, testers, doc writers.",
			empty: "No agents available.",
		},
		commands: {
			title: "Commands",
			description: "Slash commands your agents can run: releases, QA passes, PRs, retros.",
			empty: "No commands available.",
		},
		skills: {
			title: "Skills",
			description: "Skills your agents pick up. Packs install a whole curriculum at once.",
			empty: "No skills available.",
		},
		rules: {
			title: "Rules & Reference",
			description: "House rules and reference material added to your global CLAUDE.md.",
			empty: "No rules or reference entries available.",
		},
		workflows: {
			title: "Workflows",
			description: "Project workflows auto-discovered from .agent/workflows/ in each repository.",
			empty: "No workflows found. Add .md files to .agent/workflows/ in your project.",
		},
	},
	packs: {
		title: "Packs",
		description: "Curated skill bundles installed from upstream repositories.",
		npxRequired: "Packs need Node's npx on PATH to install.",
	},
	diskSkills: {
		title: "Installed on disk",
		description:
			"Skills already in ~/.claude/skills (and ~/.agents/skills). These appear on card Skills tags automatically.",
		empty: "No skills installed on disk yet. Enable Skills or a Pack above.",
	},
} as const;
