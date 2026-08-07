import { PanelRightClose } from "lucide-react";
import type { ReactElement, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useRef, useState } from "react";

import { ResizeHandle } from "@/resize/resize-handle";
import { clampBetween } from "@/resize/resize-persistence";
import { useHomeRightColumnLayout } from "@/resize/use-home-right-column-layout";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

interface HomeTriplePaneProps {
	/** Center work surface (board or git history). */
	center: ReactNode;
	/** Upper-right Jacked Accounts main surface. */
	watch: ReactNode;
	/** Lower-right Pixel Office. */
	office: ReactNode;
	/** When false, only the center pane is shown. */
	rightColumnOpen: boolean;
	/** Called when the user clicks the in-pane collapse button. */
	onCollapse: () => void;
}

/**
 * Permanent home composition: center board (~3/4) + optional right column (~1/4)
 * split into Jacked Accounts (upper) and Pixel Office (lower).
 */
export function HomeTriplePane({
	center,
	watch,
	office,
	rightColumnOpen,
	onCollapse,
}: HomeTriplePaneProps): ReactElement {
	const {
		rightColumnWidth,
		setRightColumnWidth,
		rightSplitRatio,
		setRightSplitRatio,
		rightColumnMinWidth,
		rightColumnMaxWidth,
	} = useHomeRightColumnLayout();

	const [isDraggingWidth, setIsDraggingWidth] = useState(false);
	const [isDraggingSplit, setIsDraggingSplit] = useState(false);
	const widthDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const splitDragRef = useRef<{ startY: number; startRatio: number; columnHeight: number } | null>(
		null,
	);
	const columnRef = useRef<HTMLElement | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDraggingWidth(false);
		setIsDraggingSplit(false);
		widthDragRef.current = null;
		splitDragRef.current = null;
		const previousStyle = previousBodyStyleRef.current;
		if (previousStyle) {
			document.body.style.userSelect = previousStyle.userSelect;
			document.body.style.cursor = previousStyle.cursor;
			previousBodyStyleRef.current = null;
		}
	}, []);

	useUnmount(stopDrag);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (widthDragRef.current) {
				const delta = widthDragRef.current.startX - event.clientX;
				setRightColumnWidth(
					clampBetween(
						widthDragRef.current.startWidth + delta,
						rightColumnMinWidth,
						rightColumnMaxWidth,
					),
				);
				return;
			}
			if (splitDragRef.current) {
				const delta = event.clientY - splitDragRef.current.startY;
				const next =
					splitDragRef.current.startRatio + delta / Math.max(1, splitDragRef.current.columnHeight);
				setRightSplitRatio(next);
			}
		},
		[rightColumnMaxWidth, rightColumnMinWidth, setRightColumnWidth, setRightSplitRatio],
	);

	useWindowEvent("mousemove", isDraggingWidth || isDraggingSplit ? handleMouseMove : null);
	useWindowEvent("mouseup", isDraggingWidth || isDraggingSplit ? stopDrag : null);

	const startWidthDrag = useCallback(
		(event: ReactMouseEvent) => {
			event.preventDefault();
			widthDragRef.current = { startX: event.clientX, startWidth: rightColumnWidth };
			setIsDraggingWidth(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[rightColumnWidth],
	);

	const startSplitDrag = useCallback(
		(event: ReactMouseEvent) => {
			event.preventDefault();
			const height = columnRef.current?.clientHeight ?? 400;
			splitDragRef.current = {
				startY: event.clientY,
				startRatio: rightSplitRatio,
				columnHeight: height,
			};
			setIsDraggingSplit(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ns-resize";
		},
		[rightSplitRatio],
	);

	return (
		<div data-testid="home-triple-pane" className="flex flex-1 min-h-0 min-w-0">
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{center}</div>
			{rightColumnOpen ? (
				<aside
					ref={columnRef}
					data-testid="home-right-column"
					className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface-1"
					style={{ width: rightColumnWidth, minWidth: rightColumnMinWidth }}
				>
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize right column"
						className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize"
						onMouseDown={startWidthDrag}
					/>
					<button
						type="button"
						data-testid="collapse-right-column-button"
						aria-label="Collapse right column"
						title="Collapse panel"
						onClick={onCollapse}
						className="absolute left-1 top-1 z-20 rounded p-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
					>
						<PanelRightClose size={14} />
					</button>
					<div
						data-testid="home-manager-watch-pane"
						className="flex min-h-0 flex-col overflow-hidden border-b border-border"
						style={{ flex: `${rightSplitRatio} 1 0%` }}
					>
						{watch}
					</div>
					<ResizeHandle
						orientation="horizontal"
						ariaLabel="Resize watch and office split"
						onMouseDown={startSplitDrag}
					/>
					<div
						data-testid="home-office-pane"
						className="flex min-h-0 flex-col overflow-hidden"
						style={{ flex: `${1 - rightSplitRatio} 1 0%` }}
					>
						{office}
					</div>
				</aside>
			) : null}
		</div>
	);
}
