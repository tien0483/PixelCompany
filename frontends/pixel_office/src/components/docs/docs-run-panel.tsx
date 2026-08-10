import { Hammer, ListChecks, RefreshCw, Send } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DOCS_LABELS } from "@/docs/docs-labels";
import { useDocAudit, useDocRound, type DocProjectMeta } from "@/docs/use-doc-projects";

export interface DocsRunPanelProps {
	project: DocProjectMeta;
	onBuildDone: () => void;
}

/**
 * Bottom panel: intake, build, and the two one-shot agent runs (audit / round
 * check). Mirrors the HTML feature's stream-status display, kept simpler for
 * v1 — a scrollable log plus a status line.
 */
export function DocsRunPanel({ project, onBuildDone }: DocsRunPanelProps): ReactElement {
	const [intakePaths, setIntakePaths] = useState("");
	const [intaking, setIntaking] = useState(false);
	const [building, setBuilding] = useState(false);
	const [focus, setFocus] = useState("");
	const logRef = useRef<HTMLDivElement | null>(null);

	const audit = useDocAudit();
	const round = useDocRound();

	const active = audit.status === "running" ? audit : round.status === "running" ? round : null;
	const displayed = active ?? (audit.doneAt && (!round.doneAt || audit.doneAt >= round.doneAt) ? audit : round);

	const triggerBuild = useCallback(async () => {
		setBuilding(true);
		try {
			const res = await fetch(`/api/doc-skill-proxy/api/projects/${project.id}/build`, {
				method: "POST",
			});
			if (!res.ok) {
				const data: unknown = await res.json().catch(() => null);
				const message =
					data && typeof data === "object" && "error" in data
						? String((data as { error: unknown }).error)
						: `HTTP ${res.status}`;
				throw new Error(message);
			}
			onBuildDone();
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setBuilding(false);
		}
	}, [project.id, onBuildDone]);

	const handleIntake = async () => {
		const paths = intakePaths
			.split("\n")
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		if (paths.length === 0) return;
		setIntaking(true);
		try {
			const res = await fetch(`/api/doc-skill-proxy/api/projects/${project.id}/intake`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ paths }),
			});
			if (!res.ok) {
				const data: unknown = await res.json().catch(() => null);
				const message =
					data && typeof data === "object" && "error" in data
						? String((data as { error: unknown }).error)
						: `HTTP ${res.status}`;
				throw new Error(message);
			}
			setIntakePaths("");
		} catch (err) {
			showAppToast({
				intent: "danger",
				message: err instanceof Error ? err.message : String(err),
			});
		} finally {
			setIntaking(false);
		}
	};

	// After the SSE stream reaches "done", chain a build so the site viewer reloads
	// automatically rather than requiring a second manual click.
	const auditDoneAt = audit.doneAt;
	const roundDoneAt = round.doneAt;
	useEffect(() => {
		if (audit.status === "done" && auditDoneAt) {
			void triggerBuild();
		}
	}, [audit.status, auditDoneAt, triggerBuild]);
	useEffect(() => {
		if (round.status === "done" && roundDoneAt) {
			void triggerBuild();
		}
	}, [round.status, roundDoneAt, triggerBuild]);

	useEffect(() => {
		if (!displayed || displayed.log.length === 0) return;
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [displayed]);

	const isRunning = audit.status === "running" || round.status === "running";

	return (
		<div className="flex flex-col gap-2 border-t border-border bg-surface-1 p-2 h-full min-h-0">
			<div className="flex flex-wrap items-center gap-2">
				<textarea
					value={intakePaths}
					onChange={(e) => setIntakePaths(e.target.value)}
					placeholder={DOCS_LABELS.intakePaths}
					rows={1}
					disabled={intaking}
					className="min-w-[220px] flex-1 resize-none rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
				/>
				<Button
					variant="default"
					size="sm"
					icon={intaking ? <Spinner size={12} /> : <Send size={13} />}
					disabled={intaking || intakePaths.trim().length === 0}
					onClick={() => {
						void handleIntake();
					}}
				>
					{DOCS_LABELS.intake}
				</Button>
				<Button
					variant="default"
					size="sm"
					icon={building ? <Spinner size={12} /> : <Hammer size={13} />}
					disabled={building}
					onClick={() => {
						void triggerBuild();
					}}
				>
					{building ? DOCS_LABELS.building : DOCS_LABELS.build}
				</Button>
				<input
					value={focus}
					onChange={(e) => setFocus(e.target.value)}
					placeholder={DOCS_LABELS.auditFocus}
					disabled={isRunning}
					className="h-7 w-[160px] rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
				/>
				<Button
					variant="default"
					size="sm"
					icon={audit.status === "running" ? <Spinner size={12} /> : <ListChecks size={13} />}
					disabled={isRunning}
					onClick={() => {
						void audit.run({
							projectId: project.id,
							targetRepo: project.targetRepo,
							workspaceDir: project.workspaceDir,
							focus: focus.trim() || undefined,
						});
					}}
				>
					{audit.status === "running" ? DOCS_LABELS.auditRunning : DOCS_LABELS.runAudit}
				</Button>
				<Button
					variant="default"
					size="sm"
					icon={round.status === "running" ? <Spinner size={12} /> : <RefreshCw size={13} />}
					disabled={isRunning}
					onClick={() => {
						void round.run({
							projectId: project.id,
							targetRepo: project.targetRepo,
							workspaceDir: project.workspaceDir,
						});
					}}
				>
					{round.status === "running" ? DOCS_LABELS.roundRunning : DOCS_LABELS.runRound}
				</Button>
				<span className="text-[10px] text-text-tertiary">{DOCS_LABELS.v1Note}</span>
			</div>
			<div className="flex items-center gap-2 text-[11px] text-text-secondary">
				<span className="font-medium text-text-tertiary">{DOCS_LABELS.log}</span>
				{displayed?.status === "error" && displayed.error ? (
					<span className="text-status-red">{displayed.error}</span>
				) : displayed?.status ? (
					<span>{displayed.status}</span>
				) : null}
			</div>
			<div
				ref={logRef}
				className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border bg-surface-0 px-2 py-1 font-mono text-[11px] text-text-secondary"
			>
				{!displayed || displayed.log.length === 0 ? (
					<span className="text-text-tertiary">{DOCS_LABELS.noLog}</span>
				) : (
					displayed.log.map((line, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only and never reordered.
						<div key={i}>{line}</div>
					))
				)}
			</div>
		</div>
	);
}
