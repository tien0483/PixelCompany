// Doctor check: Kanban + claude-jacked hooks must coexist in ~/.claude/settings.json.
//
// Claude Code allows multiple matchers per event. Kanban owns activity/to_review
// transitions via `kanban hooks ingest`; jacked owns additive account/memory hooks.
// This module only inspects — it never rewrites settings.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HooksCoexistenceReport {
	settingsPath: string;
	readable: boolean;
	kanbanPresent: boolean;
	jackedPresent: boolean;
	pixelAgentsPresent: boolean;
	ok: boolean;
	messages: string[];
}

const KANBAN_MARKERS = ["kanban hooks ingest", "hooks ingest --event"];
const JACKED_MARKERS = ["session_account_tracker", "memory_capture", "memory_recall", "qa_suggest"];
const PIXEL_AGENTS_MARKERS = ["pixel-agents", "claude-hook.ts", "pixel_agents"];

function collectCommands(node: unknown, into: string[]): void {
	if (typeof node === "string") {
		into.push(node);
		return;
	}
	if (Array.isArray(node)) {
		for (const item of node) {
			collectCommands(item, into);
		}
		return;
	}
	if (typeof node === "object" && node !== null) {
		const record = node as Record<string, unknown>;
		if (typeof record.command === "string") {
			into.push(record.command);
		}
		for (const value of Object.values(record)) {
			collectCommands(value, into);
		}
	}
}

function anyMarker(commands: string[], markers: string[]): boolean {
	return commands.some((command) => markers.some((marker) => command.includes(marker)));
}

export async function checkHooksCoexistence(
	settingsPath: string = join(homedir(), ".claude", "settings.json"),
): Promise<HooksCoexistenceReport> {
	const messages: string[] = [];
	let readable = false;
	let kanbanPresent = false;
	let jackedPresent = false;
	let pixelAgentsPresent = false;

	try {
		const raw = await readFile(settingsPath, "utf8");
		readable = true;
		const parsed: unknown = JSON.parse(raw);
		const commands: string[] = [];
		if (typeof parsed === "object" && parsed !== null && "hooks" in parsed) {
			collectCommands((parsed as { hooks: unknown }).hooks, commands);
		}
		kanbanPresent = anyMarker(commands, KANBAN_MARKERS);
		jackedPresent = anyMarker(commands, JACKED_MARKERS);
		pixelAgentsPresent = anyMarker(commands, PIXEL_AGENTS_MARKERS);
	} catch (error) {
		messages.push(error instanceof Error ? `Could not read ${settingsPath}: ${error.message}` : String(error));
		return {
			settingsPath,
			readable,
			kanbanPresent,
			jackedPresent,
			pixelAgentsPresent,
			ok: false,
			messages,
		};
	}

	if (!kanbanPresent) {
		messages.push("Kanban hooks (`kanban hooks ingest`) were not found. Start a task session once to install them.");
	} else {
		messages.push("Kanban hooks are present.");
	}
	if (!jackedPresent) {
		messages.push(
			"claude-jacked hooks were not found. Run `jacked install` if you want account tracking / memory vault.",
		);
	} else {
		messages.push("claude-jacked additive hooks are present.");
	}
	if (pixelAgentsPresent) {
		messages.push("Pixel Agents ingestion hooks are still installed. Remove them — Kanban owns agent activity now.");
	}

	const ok = kanbanPresent && !pixelAgentsPresent;
	if (ok && jackedPresent) {
		messages.push("Hook coexistence looks healthy (Kanban + jacked, no Pixel Agents ingestion).");
	} else if (ok) {
		messages.push("Kanban hooks look healthy. jacked hooks are optional.");
	}

	return {
		settingsPath,
		readable,
		kanbanPresent,
		jackedPresent,
		pixelAgentsPresent,
		ok,
		messages,
	};
}
