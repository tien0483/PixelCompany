import { AlertCircle, CheckCircle2, Github, Gitlab, Server, Trash2, KeyRound } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeVaultEntrySummary } from "@runtime-contract";

export interface VaultEntryRowProps {
	entry: RuntimeVaultEntrySummary;
	onDelete?: (service: string) => Promise<void> | void;
	onTestGithub?: () => Promise<{ ok: boolean; login?: string; reason?: string }>;
	isBusy?: boolean;
}

export function VaultEntryRow({ entry, onDelete, onTestGithub, isBusy }: VaultEntryRowProps): ReactElement {
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

	const handleTest = async (): Promise<void> => {
		if (!onTestGithub || testing) return;
		setTesting(true);
		setTestResult(null);
		try {
			const res = await onTestGithub();
			if (res.ok) {
				setTestResult({ ok: true, message: `Connected as @${res.login}` });
			} else {
				setTestResult({ ok: false, message: res.reason || "Validation failed" });
			}
		} catch (err) {
			setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
		} finally {
			setTesting(false);
		}
	};

	const renderIcon = (): ReactElement => {
		if (entry.kind === "github") {
			return <Github size={16} className="text-text-primary" />;
		}
		if (entry.kind === "gitlab") {
			return <Gitlab size={16} className="text-[#fc6d26]" />;
		}
		if (entry.kind === "mcp") {
			return <Server size={16} className="text-accent" />;
		}
		return <KeyRound size={16} className="text-text-secondary" />;
	};

	const renderTitle = (): string => {
		if (entry.kind === "github") {
			return entry.source === "gh-cli" ? "GitHub CLI (`gh`)" : "GitHub (Personal Access Token)";
		}
		if (entry.kind === "gitlab") {
			return `GitLab (${entry.host || "code.akselos.com"})`;
		}
		if (entry.kind === "mcp") {
			const serverName = entry.service.replace(/^mcp:/, "");
			return `MCP Server Secrets: ${serverName}`;
		}
		return entry.service;
	};

	const renderDetails = (): ReactElement => {
		if (entry.kind === "github") {
			if (entry.source === "gh-cli") {
				return (
					<span className="text-xs text-text-secondary">
						CLI auth status: <span className="font-mono text-text-primary">{entry.status || "detected"}</span>
					</span>
				);
			}
			return (
				<span className="text-xs text-text-secondary flex items-center gap-2">
					{entry.username ? <span>User: <strong className="text-text-primary">@{entry.username}</strong></span> : null}
					{entry.last4 ? <span className="font-mono text-text-tertiary">••••{entry.last4}</span> : null}
					{entry.host && entry.host !== "github.com" ? <span className="text-text-tertiary">({entry.host})</span> : null}
				</span>
			);
		}
		if (entry.kind === "gitlab") {
			return (
				<span className="text-xs text-text-secondary flex items-center gap-2">
					{entry.username ? <span>User: <strong className="text-text-primary">@{entry.username}</strong></span> : null}
				</span>
			);
		}
		if (entry.kind === "mcp") {
			const keys = entry.keys || [];
			return (
				<span className="text-xs text-text-secondary">
					{keys.length > 0 ? (
						<span>Keys: <span className="font-mono text-text-primary">{keys.join(", ")}</span></span>
					) : (
						<span>No environment variables stored</span>
					)}
				</span>
			);
		}
		return <span className="text-xs text-text-secondary">{entry.service}</span>;
	};

	return (
		<div
			data-testid={`vault-row-${entry.service}`}
			className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3 transition-colors hover:border-border-focus"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="flex items-center gap-2.5 min-w-0">
					<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-2">
						{renderIcon()}
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="text-xs font-semibold text-text-primary truncate">{renderTitle()}</span>
							<span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary uppercase">
								{entry.source}
							</span>
						</div>
						<div className="mt-0.5">{renderDetails()}</div>
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					{entry.kind === "github" && entry.source === "vault" && onTestGithub ? (
						<Button
							variant="default"
							size="sm"
							icon={testing ? <Spinner size={12} /> : undefined}
							disabled={testing || isBusy}
							onClick={() => void handleTest()}
						>
							Test
						</Button>
					) : null}

					{onDelete && entry.source !== "gh-cli" ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<Trash2 size={13} className="text-status-red" />}
							disabled={isBusy}
							onClick={() => void onDelete(entry.service)}
							title="Delete credential"
						/>
					) : null}
				</div>
			</div>

			{testResult ? (
				<div
					className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
						testResult.ok ? "bg-status-green/10 text-status-green" : "bg-status-red/10 text-status-red"
					}`}
				>
					{testResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
					<span>{testResult.message}</span>
				</div>
			) : null}

			{entry.updatedAt ? (
				<div className="text-[11px] text-text-tertiary">
					Updated {new Date(entry.updatedAt).toLocaleString()}
				</div>
			) : null}
		</div>
	);
}
