// Keeps a cached claude-jacked snapshot fresh while browser clients are watching.
//
// Polling is refcounted so a Kanban instance with no open UI makes no requests to the
// companion process. Refreshes are also triggered by jacked's own topic bus, which makes
// swaps and usage polls show up immediately rather than at the next tick.
//
// Probe failures never wipe a prior good snapshot: we keep last-known-good and set
// stale=true so the office can show cached meters without treating jacked as online.
import type { RuntimeJackedSnapshot, RuntimeJackedState } from "../core/api-contract";
import type { JackedClient } from "./jacked-client";

const JACKED_POLL_INTERVAL_MS = 30_000;
const JACKED_EVENT_DEBOUNCE_MS = 250;

/** jacked topics worth an immediate refresh. Everything else waits for the poll. */
const REFRESH_TOPICS = new Set([
	"usage_poll_updated",
	"usage_refresh_progress",
	"auto_swap_triggered",
	"auto_swap_failed",
	"all_accounts_exhausted",
	"auto_swap_stall",
	"auto_swap_stall_clear",
	"credentials_changed",
	"sessions_changed",
]);

export interface CreateJackedMonitorDependencies {
	client: JackedClient;
	onStateUpdated: (state: RuntimeJackedState) => void;
}

export interface JackedMonitor {
	/** Called when a stream client connects. Returns the state to seed that client with. */
	connect: () => RuntimeJackedState;
	disconnect: () => void;
	getState: () => RuntimeJackedState;
	refresh: () => Promise<RuntimeJackedState>;
	close: () => void;
}

function markFresh(snapshot: RuntimeJackedSnapshot): RuntimeJackedSnapshot {
	return {
		...snapshot,
		stale: false,
		lastSuccessAt: snapshot.fetchedAt,
	};
}

function markStale(prior: RuntimeJackedSnapshot): RuntimeJackedSnapshot {
	if (prior.stale) {
		return prior;
	}
	return {
		...prior,
		stale: true,
		lastSuccessAt: prior.lastSuccessAt ?? prior.fetchedAt,
	};
}

/**
 * Resolve the next cached state after a probe.
 * null fetch + no prior → null; null fetch + prior → stale LKG; success → fresh.
 */
export function resolveJackedMonitorState(
	prior: RuntimeJackedState,
	fetched: RuntimeJackedSnapshot | null,
): RuntimeJackedState {
	if (fetched !== null) {
		return markFresh(fetched);
	}
	if (prior !== null) {
		return markStale(prior);
	}
	return null;
}

export function createJackedMonitor(deps: CreateJackedMonitorDependencies): JackedMonitor {
	let subscriberCount = 0;
	let state: RuntimeJackedState = null;
	let pollTimer: NodeJS.Timeout | null = null;
	let debounceTimer: NodeJS.Timeout | null = null;
	let unsubscribe: (() => void) | null = null;
	let refreshPromise: Promise<RuntimeJackedSnapshot | null> | null = null;
	let isClosed = false;

	const refresh = async (): Promise<RuntimeJackedState> => {
		refreshPromise ??= (async () => {
			try {
				return await deps.client.fetchSnapshot();
			} catch {
				return null;
			} finally {
				refreshPromise = null;
			}
		})();
		const fetched = await refreshPromise;
		if (isClosed) {
			return state;
		}
		const next = resolveJackedMonitorState(state, fetched);
		const didChange = JSON.stringify(next) !== JSON.stringify(state);
		state = next;
		if (didChange) {
			deps.onStateUpdated(state);
		}
		return state;
	};

	const scheduleDebouncedRefresh = () => {
		if (isClosed || debounceTimer !== null) {
			return;
		}
		const timer = setTimeout(() => {
			debounceTimer = null;
			void refresh();
		}, JACKED_EVENT_DEBOUNCE_MS);
		timer.unref();
		debounceTimer = timer;
	};

	const startPolling = () => {
		if (pollTimer !== null) {
			return;
		}
		const timer = setInterval(() => {
			void refresh();
		}, JACKED_POLL_INTERVAL_MS);
		timer.unref();
		pollTimer = timer;
		unsubscribe = deps.client.subscribe((topic) => {
			if (REFRESH_TOPICS.has(topic)) {
				scheduleDebouncedRefresh();
			}
		});
		void refresh();
	};

	const stopPolling = () => {
		if (pollTimer !== null) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		if (unsubscribe !== null) {
			unsubscribe();
			unsubscribe = null;
		}
	};

	return {
		connect: () => {
			subscriberCount += 1;
			startPolling();
			return state;
		},
		disconnect: () => {
			subscriberCount = Math.max(0, subscriberCount - 1);
			if (subscriberCount === 0) {
				stopPolling();
			}
		},
		getState: () => state,
		refresh,
		close: () => {
			isClosed = true;
			subscriberCount = 0;
			stopPolling();
			deps.client.close();
		},
	};
}
