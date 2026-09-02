import { AlertCircle } from "lucide-react";
import type { ReactElement } from "react";

export function RuntimeDisconnectedFallback(): ReactElement {
	return (
		<div
			style={{
				display: "flex",
				height: "100svh",
				alignItems: "center",
				justifyContent: "center",
				background: "var(--color-surface-0)",
				padding: "24px",
			}}
		>
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
				<AlertCircle size={48} />
				<h3 className="font-semibold text-text-primary">Disconnected from Cline</h3>
				<p className="max-w-md text-center text-text-secondary">
					PIXTiel runtime is not reachable (expected on port 3484). From the repo root run{" "}
					<code className="rounded bg-surface-2 px-1.5 py-0.5 text-text-primary">npm run restart</code>
					, then reload this tab.
				</p>
			</div>
		</div>
	);
}
