import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ClineApiSeatCredentials } from "../cline-sdk/cline-provider-service";
import {
	pickDefaultAntigravityAccountId,
	pickDefaultClaudeAccountId,
	pickDefaultCursorAccountId,
} from "../manager/manager-account-pin";
import type { ManagerMonitor } from "../manager/manager-monitor";
import { resolveGeminiAccessToken } from "./flowise-llm-proxy-gemini";

const CLAUDE_SEAT_ENV = "PIXELOFFICE_FLOWISE_LLM_SEAT_ID";
const CURSOR_SEAT_ENV = "PIXELOFFICE_FLOWISE_LLM_CURSOR_SEAT_ID";
const GEMINI_SEAT_ENV = "PIXELOFFICE_FLOWISE_LLM_GEMINI_SEAT_ID";
const API_SEAT_ENV = "PIXELOFFICE_FLOWISE_LLM_API_SEAT_ID";

export interface ResolveFlowiseLlmSeatInput {
	monitor: ManagerMonitor;
	getAccountLaunchDir: (accountId: number) => Promise<{ configDir: string } | null>;
	getAccountLaunchCredential: (accountId: number) => Promise<{ apiKey: string } | null>;
	useManagerAccount?: (accountId: number) => Promise<boolean>;
	resolveApiSeatCredentials: (providerId: string) => Promise<ClineApiSeatCredentials | null>;
}

export interface FlowiseLlmAnthropicSeatContext {
	accountId: number;
	bearerToken: string;
	accountLabel: string | null;
}

export interface FlowiseLlmCursorSeatContext {
	accountId: number;
	apiKey: string;
	accountLabel: string | null;
}

export interface FlowiseLlmGeminiSeatContext {
	accountId: number | null;
	accessToken: string;
	accountLabel: string | null;
}

export interface FlowiseLlmOpenAiSeatContext {
	providerId: string;
	baseUrl: string;
	apiKey: string;
	seatLabel: string;
}

function readSeatOverride(envName: string): number | null {
	const override = process.env[envName]?.trim();
	if (override && /^\d+$/.test(override)) {
		return Number(override);
	}
	return null;
}

function accountLabel(monitor: ManagerMonitor, accountId: number): string | null {
	const snapshot = monitor.getState();
	const account = snapshot?.accounts.find((entry) => entry.id === accountId) ?? null;
	return account?.displayName ?? account?.email ?? null;
}

export async function readClaudeBearerFromLaunchDir(configDir: string): Promise<string | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(join(configDir, ".credentials.json"), "utf8"));
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const oauth = (parsed as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth;
		const token = oauth?.accessToken?.trim();
		return token && token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

export async function resolveFlowiseLlmAnthropicSeatContext(
	input: ResolveFlowiseLlmSeatInput,
): Promise<FlowiseLlmAnthropicSeatContext | null> {
	const snapshot = input.monitor.getState();
	if (!snapshot) {
		return null;
	}
	const accountId =
		readSeatOverride(CLAUDE_SEAT_ENV) ??
		pickDefaultClaudeAccountId({
			accounts: snapshot.accounts,
			activeAccountId: snapshot.activeAccountId,
		});
	if (accountId === null) {
		return null;
	}
	const launchDir = await input.getAccountLaunchDir(accountId);
	if (launchDir === null) {
		return null;
	}
	const bearerToken = await readClaudeBearerFromLaunchDir(launchDir.configDir);
	if (bearerToken === null) {
		return null;
	}
	return {
		accountId,
		bearerToken,
		accountLabel: accountLabel(input.monitor, accountId),
	};
}

export async function resolveFlowiseLlmCursorSeatContext(
	input: ResolveFlowiseLlmSeatInput,
): Promise<FlowiseLlmCursorSeatContext | null> {
	const snapshot = input.monitor.getState();
	if (!snapshot) {
		return null;
	}
	const accountId =
		readSeatOverride(CURSOR_SEAT_ENV) ??
		pickDefaultCursorAccountId({
			accounts: snapshot.accounts,
			activeAccountId: snapshot.activeAccountId,
		});
	if (accountId === null) {
		return null;
	}
	const credential = await input.getAccountLaunchCredential(accountId);
	const apiKey = credential?.apiKey?.trim();
	if (!apiKey) {
		return null;
	}
	return {
		accountId,
		apiKey,
		accountLabel: accountLabel(input.monitor, accountId),
	};
}

export async function resolveFlowiseLlmGeminiSeatContext(
	input: ResolveFlowiseLlmSeatInput,
): Promise<FlowiseLlmGeminiSeatContext | null> {
	const snapshot = input.monitor.getState();
	const pinnedAccountId = readSeatOverride(GEMINI_SEAT_ENV);
	if (pinnedAccountId !== null && input.useManagerAccount) {
		await input.useManagerAccount(pinnedAccountId);
	} else if (snapshot) {
		const accountId = pickDefaultAntigravityAccountId({
			accounts: snapshot.accounts,
			activeAccountId: snapshot.activeAccountId,
		});
		if (accountId !== null && input.useManagerAccount) {
			await input.useManagerAccount(accountId);
		}
	}
	const accessToken = await resolveGeminiAccessToken();
	if (accessToken === null) {
		return null;
	}
	const accountId = pinnedAccountId ?? (snapshot
		? pickDefaultAntigravityAccountId({
				accounts: snapshot.accounts,
				activeAccountId: snapshot.activeAccountId,
			})
		: null);
	return {
		accountId,
		accessToken,
		accountLabel: accountId !== null ? accountLabel(input.monitor, accountId) : "Antigravity",
	};
}

export async function resolveFlowiseLlmOpenAiSeatContext(
	input: ResolveFlowiseLlmSeatInput,
): Promise<FlowiseLlmOpenAiSeatContext | null> {
	const providerId = process.env[API_SEAT_ENV]?.trim().toLowerCase() || "omniroute";
	const seat = await input.resolveApiSeatCredentials(providerId);
	if (seat === null) {
		return null;
	}
	return {
		providerId: seat.providerId,
		baseUrl: seat.baseUrl,
		apiKey: seat.apiKey,
		seatLabel: seat.name,
	};
}

/** @deprecated Use resolveFlowiseLlmAnthropicSeatContext */
export async function resolveFlowiseLlmSeatContext(
	input: ResolveFlowiseLlmSeatInput,
): Promise<(FlowiseLlmAnthropicSeatContext & { configDir: string }) | null> {
	const seat = await resolveFlowiseLlmAnthropicSeatContext(input);
	if (seat === null) {
		return null;
	}
	const launchDir = await input.getAccountLaunchDir(seat.accountId);
	if (launchDir === null) {
		return null;
	}
	return { ...seat, configDir: launchDir.configDir };
}
