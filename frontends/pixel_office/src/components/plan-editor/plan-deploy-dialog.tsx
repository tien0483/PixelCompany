import { CheckCircle2, ExternalLink, Link2, Rocket, TriangleAlert } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { APPS_SCRIPT_USER_SETTINGS_URL, usePlanDeploy } from "@/components/plan-editor/use-plan-deploy";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { HTML_LABELS } from "@/html/html-labels";
import type { RuntimeDeployFailure } from "@/runtime/types";

const INPUT_CLASS =
	"w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40";

function failureMessage(failure: RuntimeDeployFailure | null): string | null {
	if (failure === "needsApiEnabled") {
		return HTML_LABELS.deployNeedsApi;
	}
	if (failure === "needsNetwork") {
		return HTML_LABELS.deployNeedsNetwork;
	}
	if (failure === "needsLogin") {
		return HTML_LABELS.deploySignedOut;
	}
	return null;
}

function SectionLabel({ children }: { children: string }): ReactElement {
	return <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{children}</div>;
}

export interface PlanDeployDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The generated `<stem>.html` plan — the only document that can be published. */
	htmlPlanId: string | null;
	planName: string;
	workspaceId: string | null;
}

/**
 * Publish flow for a generated page: Google sign-in, the browser profile the sign-in has to
 * use, and the deploy itself with its log.
 *
 * A dialog rather than a one-click button because the first deploy of a machine needs three
 * things a button cannot ask for — which Google account, which browser profile it lives in,
 * and the Apps Script API switch — and because a 30-second CLI run with no visible log is
 * indistinguishable from a hang.
 */
export function PlanDeployDialog({
	open,
	onOpenChange,
	htmlPlanId,
	planName,
	workspaceId,
}: PlanDeployDialogProps): ReactElement {
	const deploy = usePlanDeploy(htmlPlanId, workspaceId, open);
	const [chromePath, setChromePath] = useState("");
	const [chromeProfile, setChromeProfile] = useState("");
	const [code, setCode] = useState("");
	const [savingConfig, setSavingConfig] = useState(false);

	const config = deploy.status?.config ?? null;
	// Server values seed the fields; typing then owns them until the dialog is reopened.
	useEffect(() => {
		if (!open || !config) {
			return;
		}
		setChromePath(config.chromePath ?? "");
		setChromeProfile(config.chromeProfile ?? "");
	}, [open, config]);

	const planState = deploy.status?.planState ?? null;
	const loggedIn = deploy.status?.loggedIn === true;
	const failure = deploy.result?.failure ?? deploy.login?.failure ?? null;
	const errorText = deploy.result?.error ?? deploy.login?.error ?? null;
	const logText = (deploy.result?.log ?? []).filter((line) => line.trim().length > 0).join("\n");

	const handleSaveConfig = async (): Promise<void> => {
		setSavingConfig(true);
		try {
			await deploy.saveConfig({
				chromePath: chromePath.trim() || null,
				chromeProfile: chromeProfile.trim() || null,
			});
			showAppToast({ intent: "success", message: HTML_LABELS.deployProfileSaved });
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setSavingConfig(false);
		}
	};

	const handleDeploy = async (): Promise<void> => {
		try {
			const result = await deploy.deploy();
			if (result?.ok) {
				showAppToast({ intent: "success", message: HTML_LABELS.deployDone });
			} else {
				showAppToast({ intent: "danger", message: result?.error ?? HTML_LABELS.deployFailed });
			}
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		}
	};

	const handleCopy = async (url: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(url);
			showAppToast({ intent: "success", message: HTML_LABELS.deployCopied });
		} catch (error) {
			showAppToast({ intent: "danger", message: error instanceof Error ? error.message : String(error) });
		}
	};

	const currentUrl = deploy.result?.webAppUrl ?? planState?.webAppUrl ?? null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange} size="lg">
			<DialogHeader title={HTML_LABELS.deployTitle} icon={<Rocket size={15} />} />
			<DialogBody className="flex flex-col gap-4">
				<div className="text-[13px] text-text-secondary">
					{planName}
					{config ? (
						<>
							{" · "}
							<span className="text-text-tertiary">
								{HTML_LABELS.deployAccessValue} {config.domain}
							</span>
						</>
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					<SectionLabel>{HTML_LABELS.deploySignedInAs}</SectionLabel>
					<div className="flex flex-wrap items-center gap-2">
						{deploy.statusLoading && !deploy.status ? (
							<Spinner size={13} />
						) : loggedIn ? (
							<span className="inline-flex items-center gap-1.5 text-[13px] text-text-primary">
								<CheckCircle2 size={13} className="text-status-green" aria-hidden />
								{deploy.status?.account ?? "Google account"}
							</span>
						) : (
							<span className="text-[13px] text-text-secondary">{HTML_LABELS.deploySignedOut}</span>
						)}
						<Button
							size="sm"
							variant={loggedIn ? "default" : "primary"}
							disabled={deploy.signingIn}
							icon={deploy.signingIn ? <Spinner size={13} /> : undefined}
							onClick={() => void deploy.signIn({ noLocalhost: false })}
							title={HTML_LABELS.deploySignInHint}
							data-testid="plan-deploy-sign-in"
						>
							{loggedIn ? HTML_LABELS.deploySignInAgain : HTML_LABELS.deploySignIn}
						</Button>
						{!loggedIn ? (
							<Button
								size="sm"
								variant="ghost"
								disabled={deploy.signingIn}
								onClick={() => void deploy.signIn({ noLocalhost: true })}
							>
								{HTML_LABELS.deployUseCodeFlow}
							</Button>
						) : null}
					</div>

					{deploy.login?.url && deploy.login.state !== "done" ? (
						<div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2.5">
							<span className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
								<Spinner size={12} />
								{HTML_LABELS.deployConsentOpen}
							</span>
							{deploy.login.usedProfile ? null : (
								<span className="text-[11px] text-status-orange">{HTML_LABELS.deployProfileMissing}</span>
							)}
							<span className="text-[11px] text-text-tertiary">{HTML_LABELS.deployConsentManual}</span>
							<code className="break-all text-[11px] text-text-secondary">{deploy.login.url}</code>
						</div>
					) : null}

					{deploy.login?.awaitingCode ? (
						<div className="flex items-center gap-2">
							<input
								className={INPUT_CLASS}
								value={code}
								onChange={(event) => setCode(event.target.value)}
								placeholder={HTML_LABELS.deployPasteCode}
								data-testid="plan-deploy-code"
							/>
							<Button
								size="sm"
								variant="primary"
								disabled={code.trim().length === 0 || deploy.signingIn}
								onClick={() => void deploy.submitCode(code)}
							>
								{HTML_LABELS.deployPasteCodeSubmit}
							</Button>
						</div>
					) : null}
				</div>

				<div className="flex flex-col gap-2">
					<SectionLabel>{HTML_LABELS.deployProfileSection}</SectionLabel>
					<label className="flex flex-col gap-1">
						<span className="text-[11px] text-text-tertiary">{HTML_LABELS.deployProfileHint}</span>
						<input
							className={INPUT_CLASS}
							value={chromeProfile}
							onChange={(event) => setChromeProfile(event.target.value)}
							placeholder="Profile 1"
							data-testid="plan-deploy-profile"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-[11px] text-text-tertiary">{HTML_LABELS.deployProfilePathHint}</span>
						<input
							className={INPUT_CLASS}
							value={chromePath}
							onChange={(event) => setChromePath(event.target.value)}
							placeholder="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
							data-testid="plan-deploy-chrome-path"
						/>
					</label>
					<div className="flex justify-end">
						<Button
							size="sm"
							disabled={savingConfig}
							icon={savingConfig ? <Spinner size={13} /> : undefined}
							onClick={() => void handleSaveConfig()}
						>
							{HTML_LABELS.deployProfileSave}
						</Button>
					</div>
				</div>

				{currentUrl ? (
					<div className="flex flex-col gap-2">
						<SectionLabel>{HTML_LABELS.deployCurrent}</SectionLabel>
						<code className="break-all text-[12px] text-text-secondary" data-testid="plan-deploy-url">
							{currentUrl}
						</code>
						<div className="flex gap-2">
							<Button
								size="sm"
								icon={<ExternalLink size={13} />}
								onClick={() => void deploy.openUrl(currentUrl)}
							>
								{HTML_LABELS.deployOpen}
							</Button>
							<Button size="sm" icon={<Link2 size={13} />} onClick={() => void handleCopy(currentUrl)}>
								{HTML_LABELS.deployCopy}
							</Button>
						</div>
					</div>
				) : null}

				{failure || errorText ? (
					<div className="flex flex-col gap-2 rounded-md border border-status-red/30 bg-status-red/10 p-2.5">
						<span className="inline-flex items-start gap-1.5 text-[12px] text-status-red">
							<TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
							{failureMessage(failure) ?? errorText}
						</span>
						{failure === "needsApiEnabled" ? (
							<div>
								<Button size="sm" onClick={() => void deploy.openUrl(APPS_SCRIPT_USER_SETTINGS_URL)}>
									{HTML_LABELS.deployNeedsApiAction}
								</Button>
							</div>
						) : null}
					</div>
				) : null}

				{logText ? (
					<div className="flex flex-col gap-2">
						<SectionLabel>{HTML_LABELS.deployLog}</SectionLabel>
						<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-2.5 font-mono text-[11px] text-text-secondary">
							{logText}
						</pre>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="ghost" onClick={() => onOpenChange(false)}>
					Close
				</Button>
				<Button
					variant="primary"
					icon={deploy.deploying ? <Spinner size={13} /> : <Rocket size={13} />}
					disabled={!htmlPlanId || !loggedIn || deploy.deploying}
					onClick={() => void handleDeploy()}
					data-testid="plan-deploy-run"
				>
					{deploy.deploying
						? HTML_LABELS.deploying
						: planState
							? HTML_LABELS.deployRedeploy
							: HTML_LABELS.deployRun}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
