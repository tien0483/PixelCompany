const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human-readable byte size, scaling all the way to TB.
 *
 * The cleanup surface reports whole task worktrees, which run to several GB —
 * a formatter that tops out at MB turns "3.0 GB" into "3072.0 MB" and buries the
 * one number the user is deciding on.
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < UNITS.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	// Bytes are always whole; everything above gets one decimal so 1.5 GB doesn't
	// round to "2 GB".
	return unitIndex === 0
		? `${Math.round(value)} B`
		: `${value.toFixed(1)} ${UNITS[unitIndex]}`;
}
