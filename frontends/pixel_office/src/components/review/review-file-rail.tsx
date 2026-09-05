import type { ReactElement } from "react";

import { cn } from "@/components/ui/cn";
import type { ReviewFileBand } from "@/review/review-file-bands";

export interface ReviewFileRailProps {
	bands: ReviewFileBand[];
	onSelectPath: (path: string) => void;
}

/**
 * The merge request as a strip: one band per file, sized by how much it changed.
 *
 * The overview ruler beside it can only describe the file the diff pane has mounted —
 * this is the same "where am I" question asked across the whole change, and a click is
 * a file switch without a trip back to the file list.
 */
export function ReviewFileRail({ bands, onSelectPath }: ReviewFileRailProps): ReactElement | null {
	if (bands.length === 0) {
		return null;
	}
	return (
		<div className="flex w-2 shrink-0 flex-col border-l border-border bg-surface-1" data-testid="review-file-rail">
			{bands.map((band) => (
				<button
					key={band.path}
					type="button"
					title={band.label}
					aria-label={band.label}
					aria-current={band.isActive}
					data-testid={`review-file-band-${band.path}`}
					className={cn(
						"kb-review-file-band w-full cursor-pointer",
						band.isActive && "kb-review-file-band-active",
						band.isReviewed && "kb-review-file-band-reviewed",
						band.hasAttention && "kb-review-file-band-attention",
					)}
					style={{ flexGrow: band.fraction, flexBasis: 0 }}
					onClick={() => onSelectPath(band.path)}
				/>
			))}
		</div>
	);
}
