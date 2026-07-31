import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

interface FeatureToggleButtonProps {
	installed: boolean;
	busy?: boolean;
	disabled?: boolean;
	onToggle: () => void;
	/** Used to build the aria-label, e.g. the feature/shelf displayName. */
	subjectLabel: string;
}

export function FeatureToggleButton({
	installed,
	busy = false,
	disabled = false,
	onToggle,
	subjectLabel,
}: FeatureToggleButtonProps): ReactElement {
	return (
		<Button
			variant="ghost"
			size="sm"
			disabled={disabled || busy}
			onClick={onToggle}
			aria-label={`${installed ? "Remove" : "Install"} ${subjectLabel}`}
			className={cn(
				"h-6 shrink-0 px-2 text-[10px]",
				installed ? "text-status-green" : "text-text-tertiary",
			)}
		>
			{busy ? "…" : installed ? "ON" : "OFF"}
		</Button>
	);
}
