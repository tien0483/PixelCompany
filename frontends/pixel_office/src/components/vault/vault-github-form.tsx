import { AlertCircle, CheckCircle2, ExternalLink, KeyRound } from "lucide-react";
import { type ReactElement, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface VaultGithubFormProps {
	onSuccess?: (login: string) => void;
	onCancel?: () => void;
}

export function VaultGithubForm({ onSuccess, onCancel }: VaultGithubFormProps): ReactElement {
	const [token, setToken] = useState("");
	const [host, setHost] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successLogin, setSuccessLogin] = useState<string | null>(null);

	const handleSubmit = async (): Promise<void> => {
		const cleanToken = token.trim();
		if (!cleanToken || isSubmitting) return;

		setIsSubmitting(true);
		setError(null);
		setSuccessLogin(null);

		try {
			const client = getRuntimeTrpcClient(null);
			const result = await client.vault.setGithubPat.mutate({
				token: cleanToken,
				host: host.trim() || undefined,
			});

			if (!result.ok) {
				setError(result.error || "Failed to save GitHub PAT.");
				return;
			}

			const login = result.login || result.entry?.username || "authenticated user";
			setSuccessLogin(login);
			setToken("");
			onSuccess?.(login);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4" data-testid="vault-github-form">
			<div className="flex items-center justify-between">
				<h4 className="text-xs font-semibold text-text-primary flex items-center gap-1.5 m-0">
					<KeyRound size={14} className="text-accent" />
					Add GitHub Personal Access Token
				</h4>
				<a
					href="https://github.com/settings/tokens/new?scopes=repo,read:user"
					target="_blank"
					rel="noopener noreferrer"
					className="text-[11px] text-accent flex items-center gap-1 hover:underline"
				>
					Generate token <ExternalLink size={11} />
				</a>
			</div>

			<p className="text-xs text-text-secondary m-0">
				Provide a GitHub Personal Access Token (classic or fine-grained) with repository and user read access.
			</p>

			<div className="space-y-2">
				<div>
					<label className="block text-[11px] font-medium text-text-secondary mb-1">
						Personal Access Token <span className="text-status-red">*</span>
					</label>
					<input
						type="password"
						value={token}
						data-testid="github-pat-input"
						placeholder="ghp_… or github_pat_…"
						autoComplete="off"
						spellCheck={false}
						onChange={(e) => setToken(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void handleSubmit();
							}
						}}
						className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>

				<div>
					<label className="block text-[11px] font-medium text-text-secondary mb-1">
						GitHub Host (optional, defaults to github.com)
					</label>
					<input
						type="text"
						value={host}
						placeholder="github.com"
						onChange={(e) => setHost(e.target.value)}
						className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
					/>
				</div>
			</div>

			{error ? (
				<div className="flex items-center gap-1.5 text-xs text-status-red bg-status-red/10 px-2.5 py-1.5 rounded" role="alert">
					<AlertCircle size={13} className="shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			{successLogin ? (
				<div className="flex items-center gap-1.5 text-xs text-status-green bg-status-green/10 px-2.5 py-1.5 rounded">
					<CheckCircle2 size={13} className="shrink-0" />
					<span>Successfully verified and stored for @{successLogin}</span>
				</div>
			) : null}

			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="primary"
					size="sm"
					icon={isSubmitting ? <Spinner size={12} /> : undefined}
					disabled={isSubmitting || token.trim().length === 0}
					onClick={() => void handleSubmit()}
				>
					{isSubmitting ? "Validating…" : "Save & Verify"}
				</Button>
				{onCancel ? (
					<Button variant="default" size="sm" onClick={onCancel} disabled={isSubmitting}>
						Cancel
					</Button>
				) : null}
			</div>
		</div>
	);
}
