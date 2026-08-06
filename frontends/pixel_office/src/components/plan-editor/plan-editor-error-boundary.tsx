import * as Sentry from "@sentry/react";
import type { ReactElement, ReactNode } from "react";

export interface PlanEditorErrorBoundaryProps {
	children: ReactNode;
	onError: (error: Error) => void;
}

/**
 * Contains rich-editor failures to the plan pane instead of the root app boundary.
 * onError should switch the parent to plain mode and surface a toast.
 */
export function PlanEditorErrorBoundary({
	children,
	onError,
}: PlanEditorErrorBoundaryProps): ReactElement {
	return (
		<Sentry.ErrorBoundary
			beforeCapture={(scope) => {
				scope.setTag("boundary", "plan_editor");
			}}
			onError={(error) => {
				onError(error instanceof Error ? error : new Error(String(error)));
			}}
			fallback={({ error }) => {
				const message =
					error instanceof Error
						? error.message
						: "Rich editor failed. Switched to plain text editing.";
				return (
					<div
						className="flex flex-1 items-center justify-center px-3 py-6 text-sm text-text-secondary"
						data-testid="plan-editor-error-fallback"
					>
						{message}
					</div>
				);
			}}
		>
			{children}
		</Sentry.ErrorBoundary>
	);
}
