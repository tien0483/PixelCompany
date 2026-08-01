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

export function featureToggleButtonClassName(installed: boolean): string {
	return installed
		? "rounded-sm border border-status-green/30 bg-status-green/15 text-status-green hover:bg-status-green/25 hover:text-status-green"
		: "rounded-sm border border-status-red/30 bg-status-red/15 text-status-red hover:bg-status-red/25 hover:text-status-red";
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
			className={cn("h-6 shrink-0 px-2 text-[10px] font-medium", featureToggleButtonClassName(installed))}
		>
			{busy ? "…" : installed ? "ON" : "OFF"}
		</Button>
	);
}
