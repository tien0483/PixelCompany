import { AlertCircle, CheckCircle2, Plus, Server, Trash2 } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface EnvRow {
	id: string;
	key: string;
	value: string;
}

export interface VaultMcpSecretFormProps {
	onSuccess?: (serverId: string) => void;
	onCancel?: () => void;
}

export function VaultMcpSecretForm({ onSuccess, onCancel }: VaultMcpSecretFormProps): ReactElement {
	const [serverId, setServerId] = useState("");
	const [serverOptions, setServerOptions] = useState<string[]>([]);
	const [rows, setRows] = useState<EnvRow[]>([
		{ id: "row-1", key: "", value: "" },
	]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successServerId, setSuccessServerId] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void getRuntimeTrpcClient(null)
			.runtime.listMcpInventory.query()
			.then((inventory) => {
				if (cancelled || !inventory?.servers) return;
				// The vault keys MCP secrets as `mcp:<serverId>` (vault-services.ts:23), so the
				// picker offers ids, not display names.
				const serverIds = inventory.servers.map((s) => s.id).filter(Boolean);
				setServerOptions(Array.from(new Set(serverIds)));
			})
			.catch(() => {
				// Ignore inventory fetch error; manual input fallback is active
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const addRow = (): void => {
		setRows((prev) => [...prev, { id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, key: "", value: "" }]);
	};

	const removeRow = (id: string): void => {
		setRows((prev) => {
			const filtered = prev.filter((r) => r.id !== id);
			return filtered.length > 0 ? filtered : [{ id: `row-${Date.now()}`, key: "", value: "" }];
		});
	};

	const updateRow = (id: string, field: "key" | "value", val: string): void => {
		setRows((prev) =>
			prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)),
		);
	};

	const handleSubmit = async (): Promise<void> => {
		const cleanServerId = serverId.trim();
		if (!cleanServerId) {
			setError("Server ID is required.");
			return;
		}

		const env: Record<string, string> = {};
		for (const row of rows) {
			const k = row.key.trim();
			if (k) {
				env[k] = row.value;
			}
		}

		if (Object.keys(env).length === 0) {
			setError("Provide at least one environment variable key/value.");
			return;
		}

		setIsSubmitting(true);
		setError(null);
		setSuccessServerId(null);

		try {
			const client = getRuntimeTrpcClient(null);
			const result = await client.vault.setMcpSecret.mutate({
				serverId: cleanServerId,
				env,
			});

			if (!result.ok) {
				setError(result.error || "Failed to save MCP secrets.");
				return;
			}

			setSuccessServerId(cleanServerId);
			setRows([{ id: `row-${Date.now()}`, key: "", value: "" }]);
			onSuccess?.(cleanServerId);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4" data-testid="vault-mcp-form">
			<h4 className="text-xs font-semibold text-text-primary flex items-center gap-1.5 m-0">
				<Server size={14} className="text-accent" />
				Configure MCP Server Secrets
			</h4>

			<p className="text-xs text-text-secondary m-0">
				Secrets are stored encrypted in the local vault and injected into the MCP server environment on launch.
			</p>

			<div className="space-y-2">
				<div>
					<label className="block text-[11px] font-medium text-text-secondary mb-1">
						MCP Server ID / Name <span className="text-status-red">*</span>
					</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={serverId}
							data-testid="mcp-server-id-input"
							placeholder="e.g. postgres-db, github, notion"
							onChange={(e) => setServerId(e.target.value)}
							className="flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						/>
						{serverOptions.length > 0 ? (
							<select
								value=""
								onChange={(e) => {
									if (e.target.value) setServerId(e.target.value);
								}}
								className="rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-secondary focus:outline-none"
							>
								<option value="">Pick from MCP inventory…</option>
								{serverOptions.map((opt) => (
									<option key={opt} value={opt}>
										{opt}
									</option>
								))}
							</select>
						) : null}
					</div>
				</div>

				<div className="space-y-1.5 pt-1">
					<label className="block text-[11px] font-medium text-text-secondary">
						Environment Variables
					</label>
					{rows.map((row, index) => (
						<div key={row.id} className="flex items-center gap-2">
							<input
								type="text"
								value={row.key}
								placeholder="VARIABLE_NAME"
								onChange={(e) => updateRow(row.id, "key", e.target.value)}
								className="w-1/3 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
							<input
								type="password"
								value={row.value}
								placeholder="Secret value"
								autoComplete="off"
								onChange={(e) => updateRow(row.id, "value", e.target.value)}
								className="flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							/>
							<Button
								variant="ghost"
								size="sm"
								icon={<Trash2 size={12} className="text-text-tertiary hover:text-status-red" />}
								disabled={rows.length === 1 && index === 0 && !row.key && !row.value}
								onClick={() => removeRow(row.id)}
								title="Remove variable"
							/>
						</div>
					))}

					<Button variant="default" size="sm" icon={<Plus size={11} />} onClick={addRow}>
						Add environment variable
					</Button>
				</div>
			</div>

			{error ? (
				<div className="flex items-center gap-1.5 text-xs text-status-red bg-status-red/10 px-2.5 py-1.5 rounded" role="alert">
					<AlertCircle size={13} className="shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			{successServerId ? (
				<div className="flex items-center gap-1.5 text-xs text-status-green bg-status-green/10 px-2.5 py-1.5 rounded">
					<CheckCircle2 size={13} className="shrink-0" />
					<span>Successfully saved secrets for MCP server &quot;{successServerId}&quot;</span>
				</div>
			) : null}

			<div className="flex items-center gap-2 pt-1">
				<Button
					variant="primary"
					size="sm"
					icon={isSubmitting ? <Spinner size={12} /> : undefined}
					disabled={isSubmitting || !serverId.trim()}
					onClick={() => void handleSubmit()}
				>
					{isSubmitting ? "Saving…" : "Save Secrets"}
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
