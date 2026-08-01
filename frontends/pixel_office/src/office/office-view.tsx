import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeManagerState, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";
import { loadOfficeAssets } from "./assets/load-office-assets.js";
import { OfficeCanvas } from "./components/OfficeCanvas.js";
import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MAX, ZOOM_MIN } from "./constants.js";
import { EditorState } from "./editor/editorState.js";
import { OfficeState } from "./engine/officeState.js";
import { OfficeAtmosphere } from "./manager/office-atmosphere.js";
import { deriveOfficeManagerSemantics } from "./manager/office-manager-semantics.js";
import { OfficeMeterWall } from "./manager/office-meter-wall.js";
import { reconcileReviewerNpcs } from "./manager/reconcile-reviewer-npcs.js";
import { useOfficeSync } from "./use-office-sync.js";

interface OfficeViewProps {
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	workspaceId: string | null;
	/** Manager vitality data, or null when the companion process is not running. */
	manager: RuntimeManagerState;
	/** Opens the task's detail view, the same target a board card click has. */
	onSelectTask: (taskId: string) => void;
	/** The intake desk: opens Kanban's normal task creation dialog. */
	onCreateTask: () => void;
}

type LoadStatus = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/**
 * Hosts the ported pixel-agents canvas (docked in the home right-lower pane).
 *
 * Sprites are decoded lazily on first mount rather than at app startup. The engine is
 * constructed only after the decode finishes: OfficeState resolves seats and furniture
 * through the catalog that the loader populates.
 */
export function OfficeView({
	board,
	sessions,
	workspaceId,
	manager,
	onSelectTask,
	onCreateTask,
}: OfficeViewProps): ReactElement {
	const [status, setStatus] = useState<LoadStatus>({ kind: "loading" });
	const [officeState, setOfficeState] = useState<OfficeState | null>(null);
	const [zoom, setZoom] = useState(() => {
		const dprZoom = Math.round(window.devicePixelRatio || 1) * ZOOM_DEFAULT_DPR_FACTOR;
		return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, dprZoom));
	});
	const panRef = useRef({ x: 0, y: 0 });
	const editorState = useMemo(() => new EditorState(), []);
	const { resolveTaskId, handleSeatsPersist } = useOfficeSync({ officeState, board, sessions, workspaceId });
	const semantics = useMemo(() => deriveOfficeManagerSemantics(manager), [manager]);
	const managerStale = manager?.stale === true;
	const managerReachable = manager !== null && !managerStale;
	const lastSwapAtRef = useRef<number | null>(null);
	const reviewerNpcIdsRef = useRef<Set<number>>(new Set());

	const staffedCount = useMemo(() => {
		let count = 0;
		for (const column of board.columns) {
			if (column.id !== "in_progress" && column.id !== "review") {
				continue;
			}
			for (const card of column.cards) {
				const session = sessions[card.id];
				if (
					session &&
					(session.state === "running" ||
						session.state === "awaiting_review" ||
						session.state === "failed" ||
						session.state === "interrupted")
				) {
					count += 1;
				}
			}
		}
		return count;
	}, [board, sessions]);

	// Shift-change: announce + matrix flash on staff.
	useEffect(() => {
		if (!officeState || !semantics.latestSwap) {
			return;
		}
		if (lastSwapAtRef.current === semantics.latestSwap.at) {
			return;
		}
		lastSwapAtRef.current = semantics.latestSwap.at;
		const toEmail = semantics.latestSwap.toEmail ?? "incoming account";
		officeState.pushActivity(`Shift change: ${toEmail} is on duty`);
		for (const [id, character] of officeState.characters) {
			if (character.isNpc || character.isSubagent) {
				continue;
			}
			officeState.flashSpawnEffect(id);
			officeState.showSpeech(id, `${toEmail} on duty`, 4);
		}
	}, [officeState, semantics.latestSwap]);

	// Reviewer NPCs from Manager agent features.
	useEffect(() => {
		if (!officeState) {
			return;
		}
		reviewerNpcIdsRef.current = reconcileReviewerNpcs(
			officeState,
			semantics.reviewers,
			reviewerNpcIdsRef.current,
		);
	}, [officeState, semantics.reviewers]);

	useEffect(() => {
		let cancelled = false;
		loadOfficeAssets()
			.then((assets) => {
				if (cancelled) {
					return;
				}
				setOfficeState(new OfficeState(assets.defaultLayout ?? undefined));
				setStatus({ kind: "ready" });
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setStatus({
					kind: "error",
					message: error instanceof Error ? error.message : "Failed to load office sprites.",
				});
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleCanvasClick = useCallback(
		(characterId: number) => {
			const taskId = resolveTaskId(characterId);
			if (taskId !== null) {
				onSelectTask(taskId);
			}
		},
		[onSelectTask, resolveTaskId],
	);

	const noop = useCallback(() => {}, []);

	if (status.kind === "error") {
		return (
			<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
				<div className="flex flex-col items-center gap-2 text-center">
					<h3 className="text-sm font-semibold text-text-primary">Office unavailable</h3>
					<p className="max-w-md text-[13px] text-text-secondary">{status.message}</p>
				</div>
			</div>
		);
	}

	if (status.kind === "loading" || !officeState) {
		return (
			<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
				<Spinner size={30} />
			</div>
		);
	}

	return (
		<div data-testid="office-floor" className="flex flex-1 min-h-0 min-w-0 bg-surface-0">
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<OfficeCanvas
					officeState={officeState}
					onClick={handleCanvasClick}
					onSeatsPersist={handleSeatsPersist}
					isEditMode={false}
					editorState={editorState}
					onEditorTileAction={noop}
					onEditorEraseAction={noop}
					onEditorSelectionChange={noop}
					onDeleteSelected={noop}
					onRotateSelected={noop}
					onDragMove={noop}
					editorTick={0}
					zoom={zoom}
					onZoomChange={setZoom}
					panRef={panRef}
					showAreas={false}
					activeAreaLabel={null}
				/>
				<OfficeAtmosphere manager={manager} />
				<div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
					<div className="pointer-events-auto min-w-0 flex-1">
						<OfficeMeterWall
							semantics={semantics}
							managerOnline={managerReachable}
							managerStale={managerStale}
						/>
					</div>
				</div>
				{staffedCount === 0 ? (
					<div
						data-testid="office-empty-hint"
						className="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-4"
					>
						<p className="rounded-md bg-surface-1/85 px-3 py-1.5 text-[12px] text-text-secondary shadow-sm backdrop-blur">
							Agents appear when tasks are running
						</p>
					</div>
				) : null}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
					<Button
						data-testid="office-intake-cta"
						variant="primary"
						size="sm"
						onClick={onCreateTask}
						className="pointer-events-auto"
						aria-label="Create task"
					>
						Create task
					</Button>
				</div>
			</div>
		</div>
	);
}
