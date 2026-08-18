import type { ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isLightUiTheme, isThemeId, useTheme } from "@/hooks/use-theme";
import { ReviewApp } from "@/review-app/review-app";
import "@/styles/globals.css";

// Apply the persisted theme synchronously before first paint to prevent a flash.
try {
	const _savedTheme = localStorage.getItem("kanban.theme");
	if (isThemeId(_savedTheme) && _savedTheme !== "default") {
		document.documentElement.setAttribute("data-theme", _savedTheme);
	}
} catch {
	// Ignore storage access failures and keep the default theme.
}

/**
 * Sonner needs light or dark explicitly, and the picker in the list header can flip
 * that at runtime — so this reads the theme store rather than hardcoding "dark".
 */
function ThemedToaster(): ReactElement {
	const { themeId } = useTheme();
	return (
		<Toaster
			theme={isLightUiTheme(themeId) ? "light" : "dark"}
			position="bottom-right"
			toastOptions={{
				style: {
					background: "var(--color-surface-1)",
					border: "1px solid var(--color-border)",
					color: "var(--color-text-primary)",
					fontSize: "13px",
					whiteSpace: "pre-line",
				},
			}}
		/>
	);
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(
	<AppErrorBoundary>
		<TooltipProvider>
			<ReviewApp />
			<ThemedToaster />
		</TooltipProvider>
	</AppErrorBoundary>,
);
