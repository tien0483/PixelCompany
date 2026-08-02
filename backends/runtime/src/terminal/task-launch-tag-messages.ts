/**
 * Pure message builders for per-task Agent/Skill/Slash command/MCP launch tags.
 * Kept free of Node fs/path so the web UI can import the same wording.
 */
import type { RuntimeTaskLaunchSettings } from "../core/api-contract";

function normalizeIdList(ids: string[] | undefined): string[] {
	if (!ids) {
		return [];
	}
	return [
		...new Set(
			ids
				.map((id) => id.trim())
				.filter((id) => id.length > 0),
		),
	];
}

function sameIdList(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const rightSet = new Set(right);
	return left.every((id) => rightSet.has(id));
}

function hasAnyAllowlist(settings?: RuntimeTaskLaunchSettings | null): boolean {
	return (
		normalizeIdList(settings?.skillIds).length > 0 ||
		normalizeIdList(settings?.agentIds).length > 0 ||
		normalizeIdList(settings?.commandIds).length > 0 ||
		normalizeIdList(settings?.workflowIds).length > 0 ||
		normalizeIdList(settings?.mcpServerIds).length > 0
	);
}

/** Initial Cursor prompt preface when a session launches with Manager resource tags. */
export function buildCursorLaunchTagPreface(settings?: RuntimeTaskLaunchSettings | null): string | null {
	const skillIds = normalizeIdList(settings?.skillIds);
	const agentIds = normalizeIdList(settings?.agentIds);
	const commandIds = normalizeIdList(settings?.commandIds);
	const workflowIds = normalizeIdList(settings?.workflowIds);
	const mcpServerIds = normalizeIdList(settings?.mcpServerIds);
	if (
		skillIds.length === 0 &&
		agentIds.length === 0 &&
		commandIds.length === 0 &&
		workflowIds.length === 0 &&
		mcpServerIds.length === 0
	) {
		return null;
	}
	const parts: string[] = [
		"Task launch tags (PixelOffice): use only the following allowlisted Manager resources for this session.",
	];
	if (skillIds.length > 0) {
		parts.push(`Skills: ${skillIds.join(", ")}.`);
	}
	if (agentIds.length > 0) {
		parts.push(`Agents: ${agentIds.join(", ")}.`);
	}
	if (commandIds.length > 0) {
		parts.push(`Slash commands: ${commandIds.join(", ")}.`);
	}
	if (workflowIds.length > 0) {
		parts.push(`Workflows: ${workflowIds.join(", ")}.`);
	}
	if (mcpServerIds.length > 0) {
		parts.push(`MCP servers: ${mcpServerIds.join(", ")}.`);
	}
	parts.push("Do not rely on other installed skills, agents, slash commands, or MCP servers for this task.");
	return parts.join(" ");
}

/**
 * Mid-session notice when the card's resource allowlists change.
 * Returns null when skill/agent/command/MCP lists are unchanged (model/effort-only edits).
 */
export function buildLaunchTagAllowlistUpdateNotice(
	previous?: RuntimeTaskLaunchSettings | null,
	next?: RuntimeTaskLaunchSettings | null,
): string | null {
	const prevSkills = normalizeIdList(previous?.skillIds);
	const nextSkills = normalizeIdList(next?.skillIds);
	const prevAgents = normalizeIdList(previous?.agentIds);
	const nextAgents = normalizeIdList(next?.agentIds);
	const prevCommands = normalizeIdList(previous?.commandIds);
	const nextCommands = normalizeIdList(next?.commandIds);
	const prevWorkflows = normalizeIdList(previous?.workflowIds);
	const nextWorkflows = normalizeIdList(next?.workflowIds);
	const prevMcp = normalizeIdList(previous?.mcpServerIds);
	const nextMcp = normalizeIdList(next?.mcpServerIds);
	if (
		sameIdList(prevSkills, nextSkills) &&
		sameIdList(prevAgents, nextAgents) &&
		sameIdList(prevCommands, nextCommands) &&
		sameIdList(prevWorkflows, nextWorkflows) &&
		sameIdList(prevMcp, nextMcp)
	) {
		return null;
	}

	const parts: string[] = [
		"[PixelOffice] Updated task launch tags for this session. Replace any earlier allowlist with the following:",
	];

	if (!hasAnyAllowlist(next)) {
		parts.push(
			"All resource allowlists cleared — you may use all installed skills, agents, slash commands, workflows, and configured MCP servers.",
		);
	} else {
		if (nextSkills.length > 0) {
			parts.push(`Skills allowlist (current): ${nextSkills.join(", ")}.`);
		} else {
			parts.push("Skills: all installed skills are allowed.");
		}
		if (nextAgents.length > 0) {
			parts.push(`Agents allowlist (current): ${nextAgents.join(", ")}.`);
		} else {
			parts.push("Agents: all installed agents are allowed.");
		}
		if (nextCommands.length > 0) {
			parts.push(`Slash commands allowlist (current): ${nextCommands.join(", ")}.`);
		} else {
			parts.push("Slash commands: all installed slash commands are allowed.");
		}
		if (nextWorkflows.length > 0) {
			parts.push(`Workflows allowlist (current): ${nextWorkflows.join(", ")}.`);
		} else {
			parts.push("Workflows: all available workflows are allowed.");
		}
		if (nextMcp.length > 0) {
			parts.push(`MCP allowlist (current): ${nextMcp.join(", ")}.`);
		} else {
			parts.push("MCP: all configured servers are allowed.");
		}
		const removedSkills = prevSkills.filter((id) => !nextSkills.includes(id));
		const removedAgents = prevAgents.filter((id) => !nextAgents.includes(id));
		const removedCommands = prevCommands.filter((id) => !nextCommands.includes(id));
		const removedWorkflows = prevWorkflows.filter((id) => !nextWorkflows.includes(id));
		const removedMcp = prevMcp.filter((id) => !nextMcp.includes(id));
		if (removedSkills.length > 0) {
			parts.push(`No longer allowed skills: ${removedSkills.join(", ")}.`);
		}
		if (removedAgents.length > 0) {
			parts.push(`No longer allowed agents: ${removedAgents.join(", ")}.`);
		}
		if (removedCommands.length > 0) {
			parts.push(`No longer allowed slash commands: ${removedCommands.join(", ")}.`);
		}
		if (removedWorkflows.length > 0) {
			parts.push(`No longer allowed workflows: ${removedWorkflows.join(", ")}.`);
		}
		if (removedMcp.length > 0) {
			parts.push(`No longer allowed MCP servers: ${removedMcp.join(", ")}.`);
		}
		parts.push("Do not use resources outside the current allowlist.");
	}

	return parts.join(" ");
}
