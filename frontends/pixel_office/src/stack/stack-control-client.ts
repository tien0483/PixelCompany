// Browser-side client for the agent-stack sandbox switchboard.
//
// The switchboard is a separate backend (FastAPI in ~/agent-stack-sandbox,
// default :8000) rather than part of the runtime: it owns the sandbox's own
// flag file and proxy chain, and it must keep working when PixelOffice is not
// running at all. So this talks plain REST instead of going through the runtime
// tRPC client.
const DEFAULT_STACK_CONTROL_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 4000;

function getTrimmedEnvValue(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export const stackControlUrl = (
	getTrimmedEnvValue(import.meta.env.VITE_STACK_CONTROL_URL) ??
	DEFAULT_STACK_CONTROL_URL
).replace(/\/$/, "");

export const STACK_FLAG_KEYS = [
	"ENABLE_UA",
	"ENABLE_RTK",
	"ENABLE_CAVEMAN",
	"ENABLE_HEADROOM",
	"ENABLE_CCR",
	"ENABLE_DEVTOOLS",
] as const;

export type StackFlagKey = (typeof STACK_FLAG_KEYS)[number];

export type StackFlags = Record<StackFlagKey, boolean>;

export interface StackDaemonStatus {
	port: number;
	up: boolean;
}

export interface StackState {
	sandboxDir: string;
	flags: StackFlags;
	route: { target: string; chain: string[] };
	daemons: Record<string, StackDaemonStatus>;
	upstreamKeyConfigured: boolean;
	/** Flags the activator reads at `source` time, so toggling needs a new shell. */
	activationScopedFlags: StackFlagKey[];
}

/**
 * URL of the DevTools dashboard, or null when it is off or not listening.
 *
 * The host is taken from `stackControlUrl` rather than hardcoded, so pointing
 * `VITE_STACK_CONTROL_URL` at another machine moves the dashboard with it. The
 * port comes from the backend because the standalone DevTools server defaults to
 * 3456 — CCR's port — and the activator overrides it.
 */
export function stackDevtoolsUrl(state: StackState | null): string | null {
	const daemon = state?.daemons.devtools;
	if (!state?.flags.ENABLE_DEVTOOLS || !daemon?.up) return null;
	try {
		const base = new URL(stackControlUrl);
		base.port = String(daemon.port);
		base.pathname = "/";
		return base.toString();
	} catch {
		return null;
	}
}

export class StackControlUnavailableError extends Error {
	constructor(cause: unknown) {
		super(
			`Stack switchboard not reachable at ${stackControlUrl}. Start it with: source ~/agent-stack-sandbox/activate-stack.sh`,
		);
		this.name = "StackControlUnavailableError";
		this.cause = cause;
	}
}

async function requestStack(
	path: string,
	init?: RequestInit,
): Promise<StackState> {
	let response: Response;
	try {
		response = await fetch(`${stackControlUrl}${path}`, {
			...init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		// A dead daemon is the expected case (the sandbox is opt-in per shell), so
		// surface it as its own error type instead of a raw "Failed to fetch".
		throw new StackControlUnavailableError(error);
	}
	if (!response.ok) {
		let detail = `HTTP ${response.status}`;
		try {
			const body = (await response.json()) as { error?: string };
			if (body.error) detail = body.error;
		} catch {
			// Non-JSON error body: keep the status-code detail.
		}
		throw new Error(`Stack switchboard rejected the request: ${detail}`);
	}
	return (await response.json()) as StackState;
}

export async function fetchStackState(): Promise<StackState> {
	return await requestStack("/api/flags");
}

/** Partial update — the backend merges against what is on disk. */
export async function saveStackFlags(
	flags: Partial<StackFlags>,
): Promise<StackState> {
	return await requestStack("/api/flags", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ flags }),
	});
}
