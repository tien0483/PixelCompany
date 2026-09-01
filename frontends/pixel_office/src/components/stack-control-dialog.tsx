import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, SlidersHorizontal } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { notifyError, showAppToast } from "@/components/app-toaster";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	fetchStackState,
	STACK_FLAG_KEYS,
	type StackFlagKey,
	type StackFlags,
	type StackState,
	saveStackFlags,
	stackControlUrl,
} from "@/stack/stack-control-client";

const FLAG_LABELS: Record<StackFlagKey, { title: string; hint: string }> = {
	ENABLE_UA: {
		title: "Understand-Anything",
		hint: "local AST engine (/understand)",
	},
	ENABLE_RTK: {
		title: "RTK",
		hint: "terminal command interception, PATH-scoped",
	},
	ENABLE_CAVEMAN: {
		title: "Caveman",
		hint: "prompt compression skill linked into the workspace",
	},
	ENABLE_PONYTAIL: {
		title: "Ponytail",
		hint: "minimal-code skill + always-on rules (Cursor, Claude Code, Antigravity)",
	},
	ENABLE_HEADROOM: { title: "Headroom", hint: "context compression proxy" },
	ENABLE_CCR: {
		title: "CCR Gateway",
		hint: "model routing / tool translation",
	},
	ENABLE_DEVTOOLS: {
		title: "Claude DevTools",
		hint: "token + subagent dashboard",
	},
};

/** Daemon key in `state.daemons` for the flags that own a background process. */
const FLAG_DAEMONS: Partial<Record<StackFlagKey, string>> = {
	ENABLE_HEADROOM: "headroom",
	ENABLE_CCR: "ccr",
	ENABLE_DEVTOOLS: "devtools",
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function StackControlDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (nextOpen: boolean) => void;
}): ReactElement {
	const [state, setState] = useState<StackState | null>(null);
	// Draft is what the checkboxes render, so toggling stays responsive while a
	// save is in flight; it is reconciled from the server response on every load
	// and save.
	const [draft, setDraft] = useState<StackFlags | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	const loadState = useCallback(() => {
		void (async () => {
			setIsLoading(true);
			try {
				const next = await fetchStackState();
				setState(next);
				setDraft(next.flags);
				setLoadError(null);
			} catch (error) {
				// The sandbox is opt-in per shell, so "not running" is a normal state
				// worth explaining inline rather than a toast-and-forget failure.
				setLoadError(errorMessage(error));
				setState(null);
				setDraft(null);
			} finally {
				setIsLoading(false);
			}
		})();
	}, []);

	useEffect(() => {
		if (open) {
			loadState();
		}
	}, [open, loadState]);

	const handleToggle = useCallback(
		(key: StackFlagKey, checked: boolean | "indeterminate") => {
			setDraft((previous) =>
				previous ? { ...previous, [key]: checked === true } : previous,
			);
		},
		[],
	);

	const handleSave = useCallback(() => {
		if (!draft) return;
		void (async () => {
			setIsSaving(true);
			try {
				const next = await saveStackFlags(draft);
				setState(next);
				setDraft(next.flags);
				showAppToast({ intent: "success", message: "Stack flags saved" });
			} catch (error) {
				notifyError(errorMessage(error));
			} finally {
				setIsSaving(false);
			}
		})();
	}, [draft]);

	const isDirty = Boolean(
		draft &&
			state &&
			STACK_FLAG_KEYS.some((key) => draft[key] !== state.flags[key]),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogHeader
				title="Agent stack"
				icon={<SlidersHorizontal size={16} />}
			/>
			<DialogBody className="space-y-4">
				{loadError ? (
					<div
						data-testid="stack-control-error"
						className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary"
					>
						<p className="text-text-primary">Switchboard offline</p>
						<p className="mt-1">{loadError}</p>
					</div>
				) : null}

				{state ? (
					<div className="rounded-md border border-border bg-surface-2 p-3 text-xs text-text-secondary">
						<p className="text-text-primary">
							Proxy chain: {state.route.chain.join(" → ")}
						</p>
						{!state.upstreamKeyConfigured && state.route.chain.length === 1 ? (
							<p className="mt-1">
								Routing direct to Anthropic with no upstream key configured —
								set STACK_UPSTREAM_ANTHROPIC_API_KEY in the sandbox, or
								re-enable a proxy hop.
							</p>
						) : null}
					</div>
				) : null}

				{draft
					? STACK_FLAG_KEYS.map((key) => {
							const { title, hint } = FLAG_LABELS[key];
							const daemonKey = FLAG_DAEMONS[key];
							const daemon = daemonKey ? state?.daemons[daemonKey] : undefined;
							const needsNewShell =
								state?.activationScopedFlags.includes(key) ?? false;
							return (
								<label
									key={key}
									htmlFor={`stack-flag-${key}`}
									className="flex items-start gap-2 text-[13px] text-text-primary cursor-pointer select-none"
								>
									<RadixCheckbox.Root
										id={`stack-flag-${key}`}
										data-testid={`stack-flag-${key}`}
										checked={draft[key]}
										disabled={isSaving}
										onCheckedChange={(checked) => handleToggle(key, checked)}
										className="mt-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent disabled:cursor-default disabled:opacity-40"
									>
										<RadixCheckbox.Indicator>
											<Check size={10} className="text-white" />
										</RadixCheckbox.Indicator>
									</RadixCheckbox.Root>
									<span>
										{title}
										{daemon ? (
											<span className="text-text-secondary">
												{" "}
												(:{daemon.port} {daemon.up ? "up" : "down"})
											</span>
										) : null}
										<br />
										<span className="text-[12px] text-text-secondary">
											{hint}
											{needsNewShell ? " — applies to new shells" : ""}
										</span>
									</span>
								</label>
							);
						})
					: null}

				<p className="text-[12px] text-text-secondary">
					Sandbox: {state?.sandboxDir ?? "~/agent-stack-sandbox"} ·{" "}
					<a
						href={`${stackControlUrl}/ui`}
						target="_blank"
						rel="noreferrer"
						className="underline"
					>
						full switchboard
					</a>
				</p>
			</DialogBody>
			<DialogFooter>
				<Button
					variant="default"
					onClick={() => onOpenChange(false)}
					disabled={isSaving}
				>
					Close
				</Button>
				<Button
					data-testid="stack-refresh-button"
					variant="default"
					disabled={isLoading || isSaving}
					icon={isLoading ? <Spinner size={12} /> : undefined}
					onClick={loadState}
				>
					Refresh
				</Button>
				<Button
					data-testid="stack-save-button"
					variant="primary"
					disabled={!isDirty || isSaving}
					icon={isSaving ? <Spinner size={12} /> : undefined}
					onClick={handleSave}
				>
					Save &amp; apply
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
