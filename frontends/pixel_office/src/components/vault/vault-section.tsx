import { Github, KeyRound, Plus, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeVaultEntrySummary } from "@runtime-contract";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { VaultEntryRow } from "./vault-entry-row";
import { VaultGithubForm } from "./vault-github-form";
import { VaultMcpSecretForm } from "./vault-mcp-secret-form";

export function VaultSection(): ReactElement {
	const [entries, setEntries] = useState<RuntimeVaultEntrySummary[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeForm, setActiveForm] = useState<"github" | "mcp" | null>(null);
	const [isBusy, setIsBusy] = useState(false);

	const fetchEntries = useCallback(async (): Promise<void> => {
		try {
			setIsLoading(true);
			setError(null);
			const client = getRuntimeTrpcClient(null);
			const data = await client.vault.list.query();
			setEntries(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchEntries();
	}, [fetchEntries]);

	const handleDelete = async (service: string): Promise<void> => {
		if (isBusy) return;
		setIsBusy(true);
		try {
			const client = getRuntimeTrpcClient(null);
			await client.vault.delete.mutate({ service });
			await fetchEntries();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsBusy(false);
		}
	};

	const handleTestGithub = async (): Promise<{ ok: boolean; login?: string; reason?: string }> => {
		const client = getRuntimeTrpcClient(null);
		return await client.vault.testGithub.mutate();
	};

	return (
		<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4 space-y-4" data-testid="vault-section">
			<div className="flex items-center justify-between">
				<div>
					<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">
						Stored Credentials &amp; MCP Secrets
					</h6>
					<p className="text-text-secondary text-[12px] mt-1 mb-0">
						Credentials are stored locally in your 0600 vault with token values redacted over API boundaries.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					icon={isLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
					disabled={isLoading}
					onClick={() => void fetchEntries()}
					title="Refresh credentials"
				/>
			</div>

			{error ? (
				<div className="text-xs text-status-red bg-status-red/10 px-3 py-2 rounded">
					{error}
				</div>
			) : null}

			{/* Form toggles */}
			<div className="flex items-center gap-2">
				<Button
					variant={activeForm === "github" ? "primary" : "default"}
					size="sm"
					icon={<Github size={13} />}
					onClick={() => setActiveForm((prev) => (prev === "github" ? null : "github"))}
				>
					{activeForm === "github" ? "Close GitHub Form" : "Add GitHub PAT"}
				</Button>

				<Button
					variant={activeForm === "mcp" ? "primary" : "default"}
					size="sm"
					icon={<Server size={13} />}
					onClick={() => setActiveForm((prev) => (prev === "mcp" ? null : "mcp"))}
				>
					{activeForm === "mcp" ? "Close MCP Form" : "Add MCP Secret"}
				</Button>
			</div>

			{activeForm === "github" ? (
				<VaultGithubForm
					onSuccess={() => {
						void fetchEntries();
						setActiveForm(null);
					}}
					onCancel={() => setActiveForm(null)}
				/>
			) : null}

			{activeForm === "mcp" ? (
				<VaultMcpSecretForm
					onSuccess={() => {
						void fetchEntries();
						setActiveForm(null)}
					}
					onCancel={() => setActiveForm(null)}
				/>
			) : null}

			{/* Entry List */}
			{isLoading && entries.length === 0 ? (
				<div className="flex items-center justify-center py-6 text-text-tertiary">
					<Spinner size={16} />
					<span className="ml-2 text-xs">Loading vault credentials…</span>
				</div>
			) : entries.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-8 text-center">
					<ShieldCheck size={28} className="text-text-tertiary mb-2" />
					<span className="text-xs font-medium text-text-primary">No credentials configured</span>
					<p className="text-[11px] text-text-tertiary mt-1 max-w-sm">
						Add a GitHub Personal Access Token or MCP secrets to authorize automated workflows.
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{entries.map((entry) => (
						<VaultEntryRow
							key={entry.service}
							entry={entry}
							onDelete={handleDelete}
							onTestGithub={entry.kind === "github" ? handleTestGithub : undefined}
							isBusy={isBusy}
						/>
					))}
				</div>
			)}
		</div>
	);
}
