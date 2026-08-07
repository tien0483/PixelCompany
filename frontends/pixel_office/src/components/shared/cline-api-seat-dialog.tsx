import { Eye, EyeOff } from "lucide-react";
import { type ReactElement, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchClineProviderCatalog, fetchClineProviderModels } from "@/runtime/runtime-config-query";
import type { RuntimeClineProviderCatalogItem, RuntimeClineProviderModel } from "@/runtime/types";

/** Sentinel for "not in the catalog" — hands off to the full custom-endpoint form. */
export const CUSTOM_PROVIDER_VALUE = "__custom__";

export interface ClineApiSeatSubmitInput {
	providerId: string;
	apiKey: string;
	modelId: string | null;
	baseUrl: string | null;
}

/**
 * Adds an API-key seat for a provider the Cline SDK already knows (OpenRouter,
 * Anthropic, OpenAI, …).
 *
 * Everything but the key comes from the provider catalog, so this asks for one
 * field where the custom-endpoint form asks for five. Providers the catalog does
 * not carry go through that form instead — see onSelectCustom.
 */
export function ClineApiSeatDialog({
	open,
	onClose,
	onSubmit,
	onSelectCustom,
	workspaceId,
}: {
	open: boolean;
	onClose: () => void;
	onSubmit: (input: ClineApiSeatSubmitInput) => Promise<{ ok: boolean; message?: string }>;
	onSelectCustom: () => void;
	workspaceId: string | null;
}): ReactElement | null {
	const providerFieldId = useId();
	const modelFieldId = useId();
	const [catalog, setCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerId, setProviderId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [modelId, setModelId] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [models, setModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingModels, setIsLoadingModels] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		setProviderId("");
		setApiKey("");
		setModelId("");
		setBaseUrl("");
		setModels([]);
		setShowApiKey(false);
		setError(null);
		let cancelled = false;
		void fetchClineProviderCatalog(workspaceId)
			.then((providers) => {
				if (!cancelled) {
					setCatalog(providers);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setCatalog([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	const selectedProvider = useMemo(
		() => catalog.find((provider) => provider.id === providerId) ?? null,
		[catalog, providerId],
	);

	// Prefill from the catalog so the user only has to paste a key.
	useEffect(() => {
		if (!selectedProvider) {
			setModels([]);
			return;
		}
		setBaseUrl(selectedProvider.baseUrl ?? "");
		setModelId(selectedProvider.defaultModelId ?? "");
		let cancelled = false;
		setIsLoadingModels(true);
		void fetchClineProviderModels(workspaceId, selectedProvider.id)
			.then((next) => {
				if (!cancelled) {
					setModels(next);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setModels([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selectedProvider, workspaceId]);

	if (!open) {
		return null;
	}

	const canSubmit = Boolean(selectedProvider) && apiKey.trim().length > 0 && !isSaving;

	const handleProviderChange = (nextValue: string) => {
		setError(null);
		if (nextValue === CUSTOM_PROVIDER_VALUE) {
			onSelectCustom();
			return;
		}
		setProviderId(nextValue);
	};

	const handleSubmit = async () => {
		if (!selectedProvider) {
			return;
		}
		setIsSaving(true);
		setError(null);
		try {
			const result = await onSubmit({
				providerId: selectedProvider.id,
				apiKey: apiKey.trim(),
				modelId: modelId.trim() || null,
				baseUrl: baseUrl.trim() || null,
			});
			if (!result.ok) {
				setError(result.message ?? "Could not save this seat.");
				return;
			}
			onClose();
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Dialog
			open
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					onClose();
				}
			}}
		>
			<DialogHeader title="Add API key seat" />
			<DialogBody>
				<div className="flex flex-col gap-3" data-testid="cline-api-seat-dialog">
					<label htmlFor={providerFieldId} className="flex flex-col gap-1 text-[11px] text-text-secondary">
						Provider
						<NativeSelect
							id={providerFieldId}
							size="sm"
							fill
							data-testid="cline-api-seat-provider"
							value={providerId}
							onChange={(event) => {
								handleProviderChange(event.target.value);
							}}
						>
							<option value="">Choose a provider…</option>
							{catalog.map((provider) => (
								<option key={provider.id} value={provider.id}>
									{provider.name}
								</option>
							))}
							<option value={CUSTOM_PROVIDER_VALUE}>Custom OpenAI-compatible endpoint…</option>
						</NativeSelect>
					</label>

					<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
						API key
						<div className="flex items-center gap-1">
							<input
								type={showApiKey ? "text" : "password"}
								data-testid="cline-api-seat-api-key"
								className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary"
								autoComplete="off"
								spellCheck={false}
								value={apiKey}
								onChange={(event) => {
									setApiKey(event.target.value);
								}}
							/>
							<Button
								variant="ghost"
								size="sm"
								icon={showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
								aria-label={showApiKey ? "Hide API key" : "Show API key"}
								onClick={() => {
									setShowApiKey((current) => !current);
								}}
							/>
						</div>
						{selectedProvider?.env?.length ? (
							<span className="text-[10px] text-text-tertiary">
								Stored for this provider only. {selectedProvider.env.join(" / ")} in your shell is not
								read for API seats — paste the key here.
							</span>
						) : null}
					</label>

					{selectedProvider ? (
						<label htmlFor={modelFieldId} className="flex flex-col gap-1 text-[11px] text-text-secondary">
							Model
							<NativeSelect
								id={modelFieldId}
								size="sm"
								fill
								data-testid="cline-api-seat-model"
								disabled={isLoadingModels}
								value={modelId}
								onChange={(event) => {
									setModelId(event.target.value);
								}}
							>
								<option value="">
									{isLoadingModels ? "Loading models…" : "Provider default"}
								</option>
								{models.map((model) => (
									<option key={model.id} value={model.id}>
										{model.name}
									</option>
								))}
								{/* A catalog refresh can lag behind a brand-new model id; keep the prefill selectable. */}
								{modelId && !models.some((model) => model.id === modelId) ? (
									<option value={modelId}>{modelId}</option>
								) : null}
							</NativeSelect>
						</label>
					) : null}

					{selectedProvider?.supportsBaseUrl ? (
						<label className="flex flex-col gap-1 text-[11px] text-text-secondary">
							Base URL
							<input
								type="text"
								data-testid="cline-api-seat-base-url"
								className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-text-primary"
								spellCheck={false}
								value={baseUrl}
								onChange={(event) => {
									setBaseUrl(event.target.value);
								}}
							/>
						</label>
					) : null}

					{error ? <p className="text-[11px] text-status-red">{error}</p> : null}
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					data-testid="cline-api-seat-save"
					disabled={!canSubmit}
					onClick={() => {
						void handleSubmit();
					}}
				>
					{isSaving ? "Saving…" : "Add seat"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
