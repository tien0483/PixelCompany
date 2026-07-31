import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "@/App";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { PasscodeGateProvider } from "@/components/passcode-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isThemeId } from "@/hooks/use-theme";
import { isOfficeE2eHarnessEnabled, OfficeE2eHarness } from "@/office/office-e2e-harness";
import { TelemetryProvider } from "@/telemetry/posthog-provider";
import { initializeSentry } from "@/telemetry/sentry";
import "@/styles/globals.css";

initializeSentry();

// Apply the persisted theme synchronously before first paint to prevent a flash.
try {
	const _savedTheme = localStorage.getItem("kanban.theme");
	if (isThemeId(_savedTheme) && _savedTheme !== "default") {
		document.documentElement.setAttribute("data-theme", _savedTheme);
	}
} catch {
	// Ignore storage access failures and keep the default theme.
}

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

const rootTree = isOfficeE2eHarnessEnabled() ? (
	<TooltipProvider>
		<OfficeE2eHarness />
	</TooltipProvider>
) : (
	<PasscodeGateProvider>
		<TelemetryProvider>
			<AppErrorBoundary>
				<TooltipProvider>
					<App />
					<Toaster
						theme="dark"
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
				</TooltipProvider>
			</AppErrorBoundary>
		</TelemetryProvider>
	</PasscodeGateProvider>
);

ReactDOM.createRoot(root).render(rootTree);
