/**
 * User-visible copy for the Manager surface — the office-staffing framing over the
 * claude-jacked integration.
 *
 * Naming split, on purpose: files, types, tRPC procedures and test ids keep the
 * `jacked` name so they stay traceable to the upstream claude-jacked API they wrap,
 * while everything a person reads says Manager. Retheming later means editing this
 * file, not hunting literals across the views.
 *
 * The metaphor: you hire Staff (subagents), give them Playbooks (slash commands),
 * send them to Training (skills), and hold them to a Handbook (behaviour rules).
 * Seats are the Claude subscriptions those people work under.
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
	openSettings: "Open Manager settings",
	routes: {
		staff: "Staff",
		playbooks: "Playbooks",
		training: "Training",
		handbook: "Handbook",
		installations: "Installations",
		settings: "Settings",
		logs: "Logs",
		analytics: "Analytics",
	},
	/** Shown once per shelf: installing writes into the user's global ~/.claude. */
	globalInstallNotice: "Hiring and training write into your global ~/.claude, for every project.",
	shelves: {
		staff: {
			title: "Staff",
			description: "Specialist subagents you can put on the payroll — reviewers, testers, doc writers.",
			empty: "No staff available.",
		},
		playbooks: {
			title: "Playbooks",
			description: "Slash commands your agents can run: releases, QA passes, PRs, retros.",
			empty: "No playbooks available.",
		},
		training: {
			title: "Training",
			description: "Skills your agents pick up. Packs install a whole curriculum at once.",
			empty: "No training available.",
		},
		handbook: {
			title: "Handbook",
			description: "House rules and reference material added to your global CLAUDE.md.",
			empty: "No handbook entries available.",
		},
	},
	packs: {
		title: "Packs",
		description: "Curated skill bundles installed from upstream repositories.",
		npxRequired: "Packs need Node's npx on PATH to install.",
	},
} as const;
