import { Bot, CircleSlash, Plus, RefreshCw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeFlowiseFlow, RuntimeFlowiseStatus } from "@/runtime/types";

export interface AgentStudioTarget {
	/** Null opens a blank canvas — "create an agent" rather than "edit this one". */
	flow: RuntimeFlowiseFlow | null;
	baseUrl: string;
}

export function HomeSidebarAgentsTab({
	active,
	onSelect,
}: {
	active: boolean;
	onSelect: () => void;
}): ReactElement {
	return (
		<button
			type="button"
			data-testid="sidebar-agents-tab"
			onClick={onSelect}
			className={cn(
				"cursor-pointer rounded-sm px-1.5 py-1 text-[11px] font-medium",
				active
					? "bg-surface-4 text-text-primary border border-border"
					: "text-text-secondary hover:text-text-primary border border-transparent",
			)}
		>
			Agents
		</button>
	);
}

/**
 * The studio is a separate service, so this panel has three distinct empty states and they
 * are not interchangeable: not installed (the `backends/flowise` submodule was never
 * initialized or built), installed but offline (it crashed or is still booting), and
 * installed, online, no flows yet.
 */
export function HomeSidebarAgentsPanel({
	workspaceId = null,
	onOpenStudio,
}: {
	workspaceId?: string | null;
	onOpenStudio: (target: AgentStudioTarget) => void;
}): ReactElement {
	const [status, setStatus] = useState<RuntimeFlowiseStatus | null>(null);
	const [flows, setFlows] = useState<RuntimeFlowiseFlow[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const nextStatus = await trpcClient.flowise.status.query();
			setStatus(nextStatus);
			// Asking a down studio for its flows only produces a second failure with the same
			// cause, and the panel already says why it is empty.
			setFlows(nextStatus.online ? await trpcClient.flowise.flows.query() : []);
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
			setStatus(null);
			setFlows([]);
		} finally {
			setIsLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openFlow = useCallback(
		(flow: RuntimeFlowiseFlow | null) => {
			if (status === null || !status.online) {
				return;
			}
			onOpenStudio({ flow, baseUrl: status.baseUrl });
		},
		[onOpenStudio, status],
	);

	return (
		<div className="flex-1 min-h-0 flex flex-col">
			<div className="flex items-center justify-between gap-1" style={{ padding: "4px 12px 8px" }}>
				<Button
					variant="default"
					size="sm"
					icon={<Plus size={14} />}
					disabled={status === null || !status.online}
					onClick={() => openFlow(null)}
				>
					New agent
				</Button>
				<Tooltip content="Reload the studio's agent list">
					<Button
						variant="ghost"
						size="sm"
						icon={<RefreshCw size={14} className={isLoading ? "animate-spin" : undefined} />}
						aria-label="Refresh agents"
						onClick={() => {
							void refresh();
						}}
					/>
				</Tooltip>
			</div>

			<div
				className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1"
				style={{ padding: "0 12px 8px" }}
			>
				{isLoading && status === null ? (
					<div className="flex items-center justify-center" style={{ padding: "12px 0" }}>
						<Spinner size={16} />
					</div>
				) : null}

				{status !== null && !status.installed ? (
					<div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5 text-[12px]">
						<div className="flex items-center gap-1.5 text-text-primary font-medium">
							<CircleSlash size={14} className="shrink-0 text-text-tertiary" />
							Agent studio not installed
						</div>
						<p className="text-text-secondary">Initialize the fork, then build it once:</p>
						<code className="whitespace-pre-wrap break-all rounded-sm bg-surface-0 p-1.5 text-[11px] text-text-secondary">
							git submodule update --init backends/flowise{"\n"}
							cd backends/flowise && pnpm install && pnpm build
						</code>
					</div>
				) : null}

				{status !== null && status.installed && !status.online ? (
					<div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5 text-[12px]">
						<div className="flex items-center gap-1.5 text-text-primary font-medium">
							<CircleSlash size={14} className="shrink-0 text-status-orange" />
							Agent studio offline
						</div>
						<p className="text-text-secondary">
							It is installed but nothing is answering on {status.baseUrl}. First boot takes a while; its
							output is in <code className="text-[11px]">backends/flowise/.flowise/studio.log</code>.
						</p>
					</div>
				) : null}

				{status !== null && status.online && flows.length === 0 && !isLoading ? (
					<p className="text-[12px] text-text-secondary" style={{ padding: "4px 0" }}>
						No agents yet. "New agent" opens a blank canvas.
					</p>
				) : null}

				{flows.map((flow) => (
					<button
						key={flow.id}
						type="button"
						className="flex cursor-pointer items-center gap-1.5 rounded-md text-left text-text-secondary hover:bg-surface-2 hover:text-text-primary"
						style={{ padding: "6px 8px" }}
						onClick={() => openFlow(flow)}
					>
						<Bot size={14} className="shrink-0" />
						<span className="flex-1 truncate text-sm">{flow.name}</span>
						{/* Only a deployed flow answers the prediction endpoint, so only a deployed
						    flow can back a card's tool once the MCP wiring lands. */}
						{flow.deployed ? (
							<Tooltip content="Deployed — callable over the prediction API">
								<span className="shrink-0 rounded-sm bg-surface-3 px-1 py-0.5 text-[10px] text-status-green">
									live
								</span>
							</Tooltip>
						) : null}
					</button>
				))}
			</div>
		</div>
	);
}
