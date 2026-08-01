import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, BadgeCheck, ChevronDown, Download, KeyRound, Power, ShieldAlert, Trash2 } from "lucide-react";

import type { RuntimeManagerAccount } from "@/runtime/types";

import { Button } from "@/components/ui/button";
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

/** Split OAuth/paste-code trigger shared by re-auth and CC-authorize. */
function OAuthDropdownButton({
	icon,
	label,
	text,
	disabled,
	highlighted,
	onOAuth,
	onPasteCode,
}: {
	icon: ReactElement;
	label: string;
	text: string;
	disabled: boolean;
	highlighted?: boolean;
	onOAuth: () => void;
	onPasteCode: () => void;
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
					className={
						highlighted
							? "h-6 rounded border border-status-orange/30 bg-status-orange/10 px-1.5 text-[10px] text-status-orange"
							: "h-6 px-1.5 text-[10px]"
					}
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
						<p className="text-[10px] text-text-tertiary">Invite a colleague by email</p>
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
	const disabled = !online || busy;
	const offlineReason = !online ? "Manager is offline — reconnect to use seat actions" : busy ? "Working…" : null;
	const label = account.displayName ?? account.email;
	const isCursor = account.provider === "cursor";
	const isClaude = account.provider === "claude";
	const needsAttention =
		account.validationStatus === "invalid" ||
		account.validationStatus === "expired" ||
		(typeof account.lastError === "string" && account.lastError.trim().length > 0);

	return (
		<div className="mt-1 flex flex-wrap items-center gap-0.5" data-testid={`manager-account-actions-${account.id}`}>
			{isClaude ? (
				<>
					{/* No Tooltip wrapper: Radix Tooltip + DropdownMenu nesting blocks the menu open. */}
					<span
						className="inline-flex"
						title={
							offlineReason ??
							"Re-run Claude OAuth for this account"
						}
					>
						<OAuthDropdownButton
							icon={<KeyRound size={10} />}
							label={`Re-authenticate ${label}`}
							text="Re-auth"
							disabled={disabled}
							highlighted={needsAttention}
							onOAuth={onReauth}
							onPasteCode={onReauthRemote}
						/>
					</span>
					<span
						className="inline-flex"
						title={
							offlineReason ??
							(account.hasCcToken
								? "Re-run Claude Code token authorization for this account"
								: "Claude Code tokens missing — authorize now or credentials expire in ~8 hours with no way to renew")
						}
					>
						<OAuthDropdownButton
							icon={<ShieldAlert size={10} />}
							label={`Authorize Claude Code tokens for ${label}`}
							text={account.hasCcToken ? "CC" : "Add CC"}
							disabled={disabled}
							highlighted={!account.hasCcToken}
							onOAuth={onAuthorizeCc}
							onPasteCode={onAuthorizeCcRemote}
						/>
					</span>
				</>
			) : null}
			{isCursor && onReimport ? (
				<ActionTooltip content={offlineReason ?? "Re-import credential from the signed-in Cursor IDE"}>
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
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
			<ActionTooltip content={offlineReason ?? "Check the stored credential without switching to it"}>
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
							? "Disable (excluded from Kanban Auto account pick)"
							: "Enable for Kanban Auto account pick"
						: account.isActive
							? "Disable (excluded from auto-swap)"
							: "Enable for auto-swap")
				}
			>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onToggleEnabled}
					icon={<Power size={10} />}
					className={account.isActive ? "h-6 px-1.5 text-[10px]" : "h-6 px-1.5 text-[10px] text-text-tertiary"}
					aria-label={account.isActive ? `Disable ${label}` : `Enable ${label}`}
				>
					{account.isActive ? "On" : "Off"}
				</Button>
			</ActionTooltip>
			{account.canAutoSwap ? (
				<>
					<span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
					<ActionTooltip content={offlineReason ?? "Higher auto-swap priority"}>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled || isFirst}
							onClick={onMoveUp}
							icon={<ArrowUp size={10} />}
							className="h-6 px-1.5 text-[10px]"
							aria-label={`Raise auto-swap priority of ${label}`}
						/>
					</ActionTooltip>
					<ActionTooltip content={offlineReason ?? "Lower auto-swap priority"}>
						<Button
							variant="ghost"
							size="sm"
							disabled={disabled || isLast}
							onClick={onMoveDown}
							icon={<ArrowDown size={10} />}
							className="h-6 px-1.5 text-[10px]"
							aria-label={`Lower auto-swap priority of ${label}`}
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
