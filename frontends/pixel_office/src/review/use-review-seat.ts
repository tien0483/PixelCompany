import { type SeatChoice, useSeatChoice } from "@/manager/use-seat-choice";

const STORAGE_KEY_PREFIX = "pixeloffice.review.seat.";

/** @see SeatChoice — the three-way distinction is documented there. */
export type ReviewSeatChoice = SeatChoice;

/**
 * The Claude seat the review agents bill, remembered per GitLab host.
 *
 * Keyed by host rather than by merge request: a reviewer's seat is a preference that
 * should survive opening the next MR, and the review session document lives on the
 * runtime while this is a machine-local choice.
 */
export function useReviewSeat(host: string): {
	seatChoice: ReviewSeatChoice;
	setSeatChoice: (choice: ReviewSeatChoice) => void;
} {
	return useSeatChoice(`${STORAGE_KEY_PREFIX}${host}`);
}
