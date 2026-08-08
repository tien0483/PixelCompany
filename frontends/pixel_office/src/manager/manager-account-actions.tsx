import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, BadgeCheck, ChevronDown, Download, KeyRound, Power, ShieldAlert, Trash2 } from "lucide-react";

import type { RuntimeManagerAccount } from "@/runtime/types";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";

export interface ManagerAccountActionsProps {
	account: RuntimeManagerAccount;
	online: boolean;
	busy: boolean;
	/** Position in the auto-swap priority order, used to disable the edge moves. */
	isFirst: boolean;
	isLast: boolean;
	onReauth: () => void;
	/** Re-auth on this computer failed to reach jacked's loopback callback — paste the code instead. */
	onReauthRemote: () => void;
	/** Re-run just the Claude Code sub-flow (`has_cc_token` was false or its refresh died). */
	onAuthorizeCc: () => void;
	onAuthorizeCcRemote: () => void;
	/** Refresh Cursor credential snapshot from the signed-in IDE session. */
	onReimport?: () => void;
	onValidate: () => void;
	onToggleEnabled: () => void;
	onDelete: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}

/** Disabled ghost buttons use pointer-events:none — wrap so tooltips still explain why. */
function ActionTooltip({
	content,
	children,
}: {
	content: ReactNode;
	children: ReactElement;
}): ReactElement {
	return (
		<Tooltip content={content}>
			<span className="inline-flex">{children}</span>
		</Tooltip>
	);
}

/** Green = healthy token, red = re-auth needed, neutral = unknown/checking. */
type TokenActionTone = "ok" | "bad" | "neutral";

function primaryTokenTone(account: RuntimeManagerAccount): TokenActionTone {
	if (account.validationStatus === "valid") {
		return "ok";
	}
	if (account.validationStatus === "invalid" || account.validationStatus === "expired") {
		return "bad";
	}
	if (typeof account.lastError === "string" && account.lastError.trim().length > 0) {
		return "bad";
	}
	return "neutral";
}

function ccTokenTone(account: RuntimeManagerAccount): TokenActionTone {
	if (!account.hasCcToken || account.ccNeedsAuth) {
		return "bad";
	}
	return "ok";
}

function tokenActionClassName(tone: TokenActionTone): string {
	const base = "h-6 rounded px-1.5 text-[10px]";
	if (tone === "ok") {
		return `${base} border border-status-green/30 bg-status-green/10 text-status-green`;
	}
	if (tone === "bad") {
		return `${base} border border-status-red/30 bg-status-red/10 text-status-red`;
	}
	return `${base}`;
}

/** Split OAuth/paste-code trigger shared by re-auth and CC-authorize. */
function OAuthDropdownButton({
	icon,
	label,
	text,
	disabled,
	statusTone = "neutral",
	onOAuth,
	onPasteCode,
	pasteCodeHint = "Invite a colleague by email",
}: {
	icon: ReactElement;
	label: string;
	text: string;
	disabled: boolean;
	statusTone?: TokenActionTone;
	onOAuth: () => void;
	onPasteCode: () => void;
	pasteCodeHint?: string;
}): ReactElement {
	return (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger asChild>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					icon={icon}
					iconRight={<ChevronDown size={8} aria-hidden />}
					className={tokenActionClassName(statusTone)}
					aria-label={label}
					title={label}
				>
					{text}
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-[80] min-w-[11rem] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					<DropdownMenu.Item
						className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
						onSelect={onOAuth}
					>
						<p className="font-medium">OAuth</p>
						<p className="text-[10px] text-text-tertiary">Sign in on this computer</p>
					</DropdownMenu.Item>
					<DropdownMenu.Item
						className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
						onSelect={onPasteCode}
					>
						<p className="font-medium">Paste code</p>
						<p className="text-[10px] text-text-tertiary">{pasteCodeHint}</p>
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

/**
 * Per-account management strip: re-auth, validate, enable/disable, delete and
 * auto-swap priority moves.
 *
 * Ported from the jacked dashboard's `account-actions` component into Kanban chrome,
 * so the Python dashboard never has to be opened. Priority uses explicit up/down
 * moves rather than drag-and-drop — the pane is ~300px wide and each move submits
 * the full order, which is what jacked's reorder endpoint expects.
 */
export function ManagerAccountActions({
	account,
	online,
	busy,
	isFirst,
	isLast,
	onReauth,
	onReauthRemote,
	onAuthorizeCc,
	onAuthorizeCcRemote,
	onReimport,
	onValidate,
	onToggleEnabled,
	onDelete,
	onMoveUp,
	onMoveDown,
}: ManagerAccountActionsProps): ReactElement {
	const [confirmDelete, setConfirmDelete] = useState(false);
	const seatLocked = !account.isActive;
	const disabled = !online || busy;
	const actionDisabled = disabled || seatLocked;
	const offlineReason = !online ? "Manager is offline — reconnect to use seat actions" : busy ? "Working…" : null;
	const seatLockedReason = seatLocked ? "Seat is deactivated — turn On to unlock other actions" : null;
	const label = account.displayName ?? account.email;
	const isCursor = account.provider === "cursor";
	const isClaude = account.provider === "claude";
	const canReorder = account.canAutoSwap || isCursor;
	const priorityUpLabel = account.canAutoSwap
		? "Higher auto-swap priority"
		: "Higher fleet priority (primary seat)";
	const priorityDownLabel = account.canAutoSwap
		? "Lower auto-swap priority"
		: "Lower fleet priority";
	const needsAttention =
		account.validationStatus === "invalid" ||
		account.validationStatus === "expired" ||
		(typeof account.lastError === "string" && account.lastError.trim().length > 0);
	const reauthTone = primaryTokenTone(account);
	const ccTone = ccTokenTone(account);

	return (
		<div
			className={cn("mt-1 flex flex-wrap items-center gap-0.5", seatLocked && "rounded-md bg-surface-0/40 px-1 py-0.5")}
			data-testid={`manager-account-actions-${account.id}`}
			data-seat-locked={seatLocked ? "true" : "false"}
		>
			{isClaude ? (
				<>
					{/* No Tooltip wrapper: Radix Tooltip + DropdownMenu nesting blocks the menu open. */}
					<span
						className="inline-flex"
						title={
							offlineReason ??
							seatLockedReason ??
							"Re-run Claude OAuth for this account"
						}
					>
						<OAuthDropdownButton
							icon={<KeyRound size={10} />}
							label={`Re-authenticate ${label}`}
							text="Re-auth"
							disabled={actionDisabled}
							statusTone={reauthTone}
							onOAuth={onReauth}
							onPasteCode={onReauthRemote}
						/>
					</span>
					<span
						className="inline-flex"
						title={
							offlineReason ??
							seatLockedReason ??
							(account.hasCcToken
								? "Re-run Claude Code token authorization for this account"
								: "Claude Code tokens missing — authorize now or credentials expire in ~8 hours with no way to renew")
						}
					>
						<OAuthDropdownButton
							icon={<ShieldAlert size={10} />}
							label={`Authorize Claude Code tokens for ${label}`}
							text={account.hasCcToken ? "CC" : "Add CC"}
							disabled={actionDisabled}
							statusTone={ccTone}
							onOAuth={onAuthorizeCc}
							onPasteCode={onAuthorizeCcRemote}
							pasteCodeHint="CC invite email (~8h refresh token)"
						/>
					</span>
				</>
			) : null}
			{isCursor && onReimport ? (
				<ActionTooltip content={offlineReason ?? seatLockedReason ?? "Re-import credential from the signed-in Cursor IDE"}>
					<Button
						variant="ghost"
						size="sm"
						disabled={actionDisabled}
						onClick={onReimport}
						icon={<Download size={10} />}
						className={
							needsAttention
								? "h-6 rounded border border-status-orange/30 bg-status-orange/10 px-1.5 text-[10px] text-status-orange"
								: "h-6 px-1.5 text-[10px]"
						}
						aria-label={`Re-import ${label} from Cursor IDE`}
					>
						Re-import
					</Button>
				</ActionTooltip>
			) : null}
			<ActionTooltip
				content={offlineReason ?? "Check the stored credential without switching to it (works on deactivated seats)"}
			>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onValidate}
					icon={<BadgeCheck size={10} />}
					className="h-6 px-1.5 text-[10px]"
					aria-label={`Validate ${label}`}
				>
					Check
				</Button>
			</ActionTooltip>
			<ActionTooltip
				content={
					offlineReason ??
					(isCursor
						? account.isActive
							? "Deactivate (excluded from Kanban Auto account pick)"
							: "Activate for Kanban Auto account pick"
						: account.isActive
							? "Deactivate (excluded from auto-swap)"
							: "Activate for auto-swap")
				}
			>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onToggleEnabled}
					icon={<Power size={10} />}
					className={
						account.isActive
							? "h-6 px-1.5 text-[10px]"
							: "h-6 rounded border border-status-green/30 bg-status-green/10 px-1.5 text-[10px] text-status-green"
					}
					aria-label={account.isActive ? `Deactivate ${label}` : `Activate ${label}`}
				>
					{account.isActive ? "Off" : "On"}
				</Button>
			</ActionTooltip>
			{canReorder ? (
				<>
					<span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
					<ActionTooltip content={offlineReason ?? seatLockedReason ?? priorityUpLabel}>
						<Button
							variant="ghost"
							size="sm"
							disabled={actionDisabled || isFirst}
							onClick={onMoveUp}
							icon={<ArrowUp size={10} />}
							className="h-6 px-1.5 text-[10px]"
							aria-label={`Raise priority of ${label}`}
						/>
					</ActionTooltip>
					<ActionTooltip content={offlineReason ?? seatLockedReason ?? priorityDownLabel}>
						<Button
							variant="ghost"
							size="sm"
							disabled={actionDisabled || isLast}
							onClick={onMoveDown}
							icon={<ArrowDown size={10} />}
							className="h-6 px-1.5 text-[10px]"
							aria-label={`Lower priority of ${label}`}
						/>
					</ActionTooltip>
				</>
			) : null}
			<ActionTooltip content={offlineReason ?? "Remove this account from Manager"}>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setConfirmDelete(true)}
					icon={<Trash2 size={10} />}
					className="ml-auto h-6 px-1.5 text-[10px] text-status-red"
					aria-label={`Delete ${label}`}
				/>
			</ActionTooltip>
			<AlertDialog
				open={confirmDelete}
				onOpenChange={(isOpen) => {
					if (!isOpen) {
						setConfirmDelete(false);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {label} from Manager?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						Tasks pinned to this account fall back to the active account on their next start.
					</AlertDialogDescription>
					<p className="text-text-primary">
						{isCursor
							? "This removes the stored Cursor credential snapshot from manager. Sign in to Cursor IDE again and re-import to add it back."
							: "This removes the stored credential from manager. Your Claude subscription is untouched, and you can add the account again with OAuth."}
					</p>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button variant="default" onClick={() => setConfirmDelete(false)}>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							onClick={() => {
								setConfirmDelete(false);
								onDelete();
							}}
						>
							Remove account
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</div>
	);
}
