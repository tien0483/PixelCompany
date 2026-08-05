import { useRef, useState } from "react";
import type { BoardData } from "@/types";
import { playAlertBeep } from "@/utils/play-alert-beep";
import { useInterval } from "@/utils/react-use";

const REVIEW_STALE_THRESHOLD_MS = 30_000;
const REVIEW_STALENESS_POLL_INTERVAL_MS = 5000;

interface UseReviewStalenessAlertOptions {
	board: BoardData;
}

function hasAppBadgeSupport(): boolean {
	return typeof navigator !== "undefined" && "setAppBadge" in navigator;
}

function setAppBadgeCount(count: number): void {
	if (!hasAppBadgeSupport()) {
		return;
	}
	try {
		if (count > 0) {
			void navigator.setAppBadge(count).catch(() => {
				// Ignore badge failures (e.g. not installed as a PWA).
			});
		} else {
			void navigator.clearAppBadge?.().catch(() => {
				// Ignore badge failures.
			});
		}
	} catch {
		// Ignore browsers without a working Badging API.
	}
}

/**
 * Watches the "review" column for tasks that have sat there longer than
 * REVIEW_STALE_THRESHOLD_MS, badges the PWA app icon with the stale count,
 * and plays a one-time beep the moment each task crosses the threshold.
 */
export function useReviewStalenessAlert({ board }: UseReviewStalenessAlertOptions): number {
	const alertedTaskIdsRef = useRef<Set<string>>(new Set());
	const [staleReviewCount, setStaleReviewCount] = useState(0);

	useInterval(() => {
		const reviewColumn = board.columns.find((column) => column.id === "review");
		const reviewTaskIds = new Set(reviewColumn?.cards.map((card) => card.id) ?? []);

		for (const taskId of alertedTaskIdsRef.current) {
			if (!reviewTaskIds.has(taskId)) {
				alertedTaskIdsRef.current.delete(taskId);
			}
		}

		if (!reviewColumn) {
			setStaleReviewCount(0);
			setAppBadgeCount(0);
			return;
		}

		const now = Date.now();
		let staleCount = 0;
		for (const card of reviewColumn.cards) {
			if (card.reviewEnteredAt === undefined || now - card.reviewEnteredAt <= REVIEW_STALE_THRESHOLD_MS) {
				continue;
			}
			staleCount += 1;
			if (!alertedTaskIdsRef.current.has(card.id)) {
				alertedTaskIdsRef.current.add(card.id);
				playAlertBeep();
			}
		}

		setStaleReviewCount(staleCount);
		setAppBadgeCount(staleCount);
	}, REVIEW_STALENESS_POLL_INTERVAL_MS);

	return staleReviewCount;
}
