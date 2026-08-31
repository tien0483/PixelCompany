import { Bot, CircleSlash, Network, Plus, RefreshCw } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeFlowiseFlow,
	RuntimeFlowiseLlmProxyStatus,
	RuntimeFlowiseStatus,
	RuntimeOrchestratorStatus,
} from "@/runtime/types";

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

function FlowiseLlmProxyPanel({ status }: { status: RuntimeFlowiseLlmProxyStatus | null }): ReactElement | null {
	if (status === null) {
		return null;
	}
	return (
		<div
			className="mt-2 rounded-md border border-border bg-surface-1 p-2 text-[11px] text-text-secondary"
			data-testid="sidebar-flowise-llm-proxy"
		>
			<p className="font-medium text-text-primary">Flowise LLM proxy</p>
			<p className="mt-1">
				{status.available
					? "Studio nodes can bill through Manager / Cline seats."
					: status.enabled
						? "Proxy enabled — no live seats for wired nodes."
						: "Disabled — use Flowise Credentials."}
			</p>
			{(status.providers?.length ?? 0) > 0 ? (
				<ul className="mt-1 list-disc pl-4 text-[10px]">
					{status.providers?.map((provider) => (
						<li key={provider.id}>
							<span className="text-text-primary">{provider.flowiseNode ?? provider.id}</span>:{" "}
							{provider.available ? (
								// A seat and a working route are different claims: the seat can be
								// live while the route fails (wrong header, blocked base URL). Only
								// a verified probe earns green.
								provider.pathVerified === false ? (
									<Tooltip content={provider.pathDetail ?? "The proxy route did not answer"}>
										<span className="text-status-red">
											{provider.seatLabel ?? "seat"} · route failing
										</span>
									</Tooltip>
								) : (
									<span className={provider.pathVerified ? "text-status-green" : "text-status-orange"}>
										{provider.seatLabel ?? "seat"}
										{provider.pathVerified ? "" : " · unverified"}
									</span>
								)
							) : (
								<span className="text-status-orange">no seat</span>
							)}
						</li>
					))}
				</ul>
			) : null}
			{(status.hints?.length ?? 0) > 0 ? (
				<ul className="mt-1 list-disc pl-4 text-[10px]">
					{status.hints?.slice(0, 3).map((hint) => (
						<li key={hint}>{hint}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function OrchestratorStatusPanel({
	status,
	isLoading,
}: {
	status: RuntimeOrchestratorStatus | null;
	isLoading: boolean;
}): ReactElement {
	if (isLoading && status === null) {
		return (
			<div className="flex items-center justify-center" style={{ padding: "8px 0" }}>
				<Spinner size={14} />
			</div>
		);
	}
	if (status === null) {
		return (
			<p className="text-[11px] text-text-secondary" style={{ padding: "4px 0" }}>
				Orchestrator status unavailable.
			</p>
		);
	}

	const ready = status.installed && status.subagentsInstalled !== false;
	return (
		<div
			className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-2.5 text-[12px]"
			data-testid="sidebar-orchestrator-status"
		>
			<div className="flex items-center gap-1.5 text-text-primary font-medium">
				<Network size={14} className="shrink-0 text-text-tertiary" />
				Orchestrator (dsh)
			</div>
			<ul className="flex flex-col gap-1 text-[11px] text-text-secondary">
				<li>
					<span className="text-text-tertiary">dsh:</span>{" "}
					{status.installed ? (
						<span className="text-status-green">ready</span>
					) : (
						<span className="text-status-orange">not installed</span>
					)}
					{status.binary ? (
						<span className="block truncate text-[10px] text-text-tertiary" title={status.binary}>
							{status.binary}
						</span>
					) : null}
				</li>
				<li>
					<span className="text-text-tertiary">Subagents:</span>{" "}
					{status.subagentsInstalled ? (
						<span className="text-status-green">installed</span>
					) : (
						<span className="text-status-orange">installing…</span>
					)}
				</li>
				<li>
					<span className="text-text-tertiary">Flowise:</span>{" "}
					{status.flowiseOnline ? (
						<span className="text-status-green">online</span>
					) : (
						<span className="text-status-orange">offline</span>
					)}
				</li>
				{status.dshHome ? (
					<li className="truncate text-[10px] text-text-tertiary" title={status.dshHome}>
						DSH_HOME: {status.dshHome}
					</li>
				) : null}
			</ul>
			{ready ? (
				<p className="text-[11px] text-text-secondary">
					Pick <strong className="font-medium text-text-primary">Orchestrator (dsh)</strong> on a task card.
					Attach <code className="text-[10px]">flowise-*</code> MCP — Cursor children auto-read{" "}
					<code className="text-[10px]">.cursor/mcp.json</code> in the worktree.
				</p>
			) : null}
			{(status.hints?.length ?? 0) > 0 ? (
				<ul className="flex flex-col gap-1 text-[11px] text-text-secondary list-disc pl-4">
					{status.hints?.map((hint) => (
						<li key={hint}>{hint}</li>
					))}
				</ul>
			) : null}
		</div>
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
	const [orchestratorStatus, setOrchestratorStatus] = useState<RuntimeOrchestratorStatus | null>(null);
	const [llmProxyStatus, setLlmProxyStatus] = useState<RuntimeFlowiseLlmProxyStatus | null>(null);
	const [flows, setFlows] = useState<RuntimeFlowiseFlow[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [orchestratorLoading, setOrchestratorLoading] = useState(true);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setOrchestratorLoading(true);
		try {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const [nextStatus, nextOrchestrator, nextProxy] = await Promise.all([
				trpcClient.flowise.status.query(),
				trpcClient.orchestrator.status.query(),
				trpcClient.flowise.llmProxyStatus.query(),
			]);
			setStatus(nextStatus);
			setOrchestratorStatus(nextOrchestrator);
			setLlmProxyStatus(nextProxy);
			// Asking a down studio for its flows only produces a second failure with the same
			// cause, and the panel already says why it is empty.
			setFlows(nextStatus.online ? await trpcClient.flowise.flows.query() : []);
		} catch (error) {
			showAppToast({
				intent: "danger",
				message: error instanceof Error ? error.message : String(error),
			});
			setStatus(null);
			setOrchestratorStatus(null);
			setLlmProxyStatus(null);
			setFlows([]);
		} finally {
			setIsLoading(false);
			setOrchestratorLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// First boot is slow; keep probing until the sidecar answers instead of flashing "offline".
	useEffect(() => {
		if (status?.installed !== true || status.online) {
			return;
		}
		const timer = window.setInterval(() => {
			void refresh();
		}, 5000);
		return () => {
			window.clearInterval(timer);
		};
	}, [refresh, status?.installed, status?.online]);

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
				<Tooltip content="Reload the studio's agent list and orchestrator status">
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
							{isLoading ? "Agent studio starting…" : "Agent studio offline"}
						</div>
						<p className="text-text-secondary">
							{isLoading
								? "Waiting for Flowise on "
								: "It is installed but nothing is answering on "}
							{status.baseUrl}. First boot takes a while; its output is in{" "}
							<code className="text-[11px]">backends/flowise/.flowise/studio.log</code>.
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
							<Tooltip content="Deployed — attach flowise-{id} on task MCP picker; Cursor/Agy auto-wire on launch">
								<span className="shrink-0 rounded-sm bg-surface-3 px-1 py-0.5 text-[10px] text-status-green">
									live
								</span>
							</Tooltip>
						) : null}
					</button>
				))}

				<FlowiseLlmProxyPanel status={llmProxyStatus} />

				<div className="mt-2 border-t border-border pt-2">
					<OrchestratorStatusPanel status={orchestratorStatus} isLoading={orchestratorLoading} />
				</div>
			</div>
		</div>
	);
}
