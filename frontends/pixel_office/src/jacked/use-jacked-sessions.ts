import { useEffect, useState } from "react";

import type { RuntimeJackedSession } from "@/runtime/types";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

/** Sessions come from jacked's hook table, which only updates on agent activity. */
const SESSIONS_POLL_MS = 15_000;

export interface JackedSessionsByAccount {
	/** Live Claude Code sessions keyed by jacked account id. */
	byAccountId: Map<number, RuntimeJackedSession[]>;
	total: number;
}

const EMPTY: JackedSessionsByAccount = { byAccountId: new Map(), total: 0 };

function groupByAccount(sessions: RuntimeJackedSession[]): JackedSessionsByAccount {
	const byAccountId = new Map<number, RuntimeJackedSession[]>();
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
export function useJackedSessions(online: boolean): JackedSessionsByAccount {
	const [sessions, setSessions] = useState<JackedSessionsByAccount>(EMPTY);

	useEffect(() => {
		if (!online) {
			setSessions(EMPTY);
			return;
		}
		let cancelled = false;
		const load = async () => {
			try {
				const result = await getRuntimeTrpcClient(null).jacked.activeSessions.query();
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
