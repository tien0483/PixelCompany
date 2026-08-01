import { useEffect, useState } from "react";

import type { RuntimeManagerSession } from "@/runtime/types";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/** Sessions come from Manager's hook table, which only updates on agent activity. */
const SESSIONS_POLL_MS = 15_000;

export interface ManagerSessionsByAccount {
	/** Live Claude Code sessions keyed by jacked account id. */
	byAccountId: Map<number, RuntimeManagerSession[]>;
	total: number;
}

const EMPTY: ManagerSessionsByAccount = { byAccountId: new Map(), total: 0 };

function groupByAccount(sessions: RuntimeManagerSession[]): ManagerSessionsByAccount {
	const byAccountId = new Map<number, RuntimeManagerSession[]>();
	for (const session of sessions) {
		const existing = byAccountId.get(session.accountId);
		if (existing) {
			existing.push(session);
		} else {
			byAccountId.set(session.accountId, [session]);
		}
	}
	return { byAccountId, total: sessions.length };
}

/**
 * Live Claude Code sessions grouped per account.
 *
 * This is what makes concurrent multi-account work visible: a task pinned to an
 * account reports itself through jacked's CLAUDE_CONFIG_DIR-aware session hook, so
 * two accounts each showing a session is proof the pins took effect.
 */
export function useManagerSessions(online: boolean): ManagerSessionsByAccount {
	const [sessions, setSessions] = useState<ManagerSessionsByAccount>(EMPTY);

	useEffect(() => {
		if (!online) {
			setSessions(EMPTY);
			return;
		}
		let cancelled = false;
		const load = async () => {
			try {
				const result = await getRuntimeTrpcClient(null).manager.activeSessions.query();
				if (!cancelled) {
					setSessions(result ? groupByAccount(result.sessions) : EMPTY);
				}
			} catch {
				// Leave the last known grouping in place; the next tick resyncs.
			}
		};
		void load();
		const timer = setInterval(() => {
			void load();
		}, SESSIONS_POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [online]);

	return sessions;
}
