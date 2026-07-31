import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { RuntimeJackedHookLogs, RuntimeJackedServerLogs } from "@/runtime/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { MANAGER_LABELS } from "@/jacked/manager-labels";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

type LogsTab = "server" | "hooks";

interface JackedLogsViewProps {
	online: boolean;
}

function levelClass(level: string): string {
	const upper = level.toUpperCase();
	if (upper === "ERROR" || upper === "CRITICAL") {
		return "text-status-red";
	}
	if (upper === "WARNING") {
		return "text-status-orange";
	}
	return "text-text-tertiary";
}

/**
 * Native Logs surface — server ring buffer + recent hook executions.
 */
export function JackedLogsView({ online }: JackedLogsViewProps): ReactElement {
	const [tab, setTab] = useState<LogsTab>("server");
	const [serverLogs, setServerLogs] = useState<RuntimeJackedServerLogs | null>(null);
	const [hookLogs, setHookLogs] = useState<RuntimeJackedHookLogs | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async () => {
		if (!online) {
			setServerLogs(null);
			setHookLogs(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const trpc = getRuntimeTrpcClient(null);
			const [server, hooks] = await Promise.all([
				trpc.jacked.serverLogs.query({ limit: 80 }),
				trpc.jacked.hookLogs.query({ limit: 40 }),
			]);
			setServerLogs(server);
			setHookLogs(hooks);
			if (server === null && hooks === null) {
				setError("Could not load logs.");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not load logs.");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
	}, [online]);

	if (!online) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<p className="text-[12px] text-text-secondary">{MANAGER_LABELS.offline}</p>
				<p className="text-[11px] text-text-tertiary">Logs require the companion.</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="jacked-logs-view">
			<div className="flex items-center gap-1 border-b border-border px-2 py-1 shrink-0">
				{(["server", "hooks"] as const).map((id) => (
					<button
						key={id}
						type="button"
						onClick={() => setTab(id)}
						className={cn(
							"rounded-md px-2 py-1 text-[10px]",
							tab === id
								? "bg-surface-4 text-text-primary border border-border"
								: "text-text-secondary border border-transparent hover:bg-surface-2",
						)}
					>
						{id === "server" ? "Server" : "Hooks"}
					</button>
				))}
				<span className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					icon={<RefreshCw size={12} />}
					aria-label="Reload logs"
					disabled={loading}
					onClick={() => {
						void load();
					}}
				/>
			</div>
			{error ? (
				<p className="shrink-0 border-b border-border px-2 py-1 text-[10px] text-status-red">{error}</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 font-mono text-[10px]">
				{tab === "server" ? (
					!serverLogs || serverLogs.entries.length === 0 ? (
						<p className="font-sans text-[11px] text-text-tertiary">
							{loading ? "Loading…" : "No server log entries."}
						</p>
					) : (
						<div className="flex flex-col gap-1">
							{serverLogs.entries
								.slice()
								.reverse()
								.map((entry, index) => (
									<div key={`${entry.timestamp ?? "t"}-${index}`} className="break-words">
										<span className={levelClass(entry.level)}>[{entry.level}]</span>{" "}
										<span className="text-text-tertiary">{entry.timestamp ?? ""}</span>{" "}
										<span className="text-text-secondary">{entry.message}</span>
									</div>
								))}
						</div>
					)
				) : !hookLogs || hookLogs.logs.length === 0 ? (
					<p className="font-sans text-[11px] text-text-tertiary">
						{loading ? "Loading…" : "No hook executions."}
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{hookLogs.logs.map((entry, index) => (
							<div
								key={`${entry.id ?? index}-${entry.createdAt ?? ""}`}
								className="rounded-md border border-border bg-surface-1 px-2 py-1.5 font-sans"
							>
								<p className="text-[11px] text-text-primary">
									{entry.hookName ?? "hook"} · {entry.status ?? "?"}
								</p>
								<p className="text-[10px] text-text-tertiary">{entry.createdAt ?? ""}</p>
								{entry.detail ? (
									<p className="mt-0.5 text-[10px] text-text-secondary">{entry.detail}</p>
								) : null}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
