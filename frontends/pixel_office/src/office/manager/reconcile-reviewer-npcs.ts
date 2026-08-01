/**
 * Reconciles jacked reviewer features onto persistent office NPCs in the review room.
 */
import { hashReviewerNpcId } from "../adapter/board-to-office.js";
import type { OfficeState } from "../engine/officeState.js";
import type { ReviewerNpc } from "./office-manager-semantics.js";

const REVIEW_SEAT_PREFIXES = ["f_grey_", "f_mkt_"] as const;

function pickReviewSeat(officeState: OfficeState, preferred?: string): string | undefined {
	if (preferred) {
		const seat = officeState.seats.get(preferred);
		if (seat && !seat.assigned) {
			return preferred;
		}
	}
	for (const prefix of REVIEW_SEAT_PREFIXES) {
		for (const [uid, seat] of officeState.seats) {
			if (!seat.assigned && uid.startsWith(prefix)) {
				return uid;
			}
		}
	}
	return undefined;
}

export function reconcileReviewerNpcs(
	officeState: OfficeState,
	reviewers: ReviewerNpc[],
	previousIds: Set<number>,
): Set<number> {
	const nextIds = new Set<number>();
	const activeReviewers = reviewers.filter((reviewer) => reviewer.active).slice(0, 6);

	for (let index = 0; index < activeReviewers.length; index++) {
		const reviewer = activeReviewers[index];
		if (!reviewer) {
			continue;
		}
		const id = hashReviewerNpcId(reviewer.name);
		nextIds.add(id);
		if (officeState.characters.has(id)) {
			continue;
		}
		const seatId = pickReviewSeat(officeState);
		officeState.addNpc({
			id,
			palette: (index % 6) as number,
			hueShift: 40 + index * 25,
			seatId: seatId ?? null,
			script: [{ kind: "typeAtSeat", seconds: 12 }],
		});
	}

	for (const id of previousIds) {
		if (!nextIds.has(id)) {
			officeState.removeNpc(id);
		}
	}

	return nextIds;
}
