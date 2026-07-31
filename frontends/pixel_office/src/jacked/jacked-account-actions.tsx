import type { ReactElement } from "react";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ArrowDown, ArrowUp, BadgeCheck, ChevronDown, KeyRound, Power, ShieldAlert, Trash2 } from "lucide-react";

import type { RuntimeJackedAccount } from "@/runtime/types";

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

export interface JackedAccountActionsProps {
	account: RuntimeJackedAccount;
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
	onValidate: () => void;
	onToggleEnabled: () => void;
	onDelete: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
}

/** Split OAuth/paste-code trigger shared by re-auth and CC-authorize. */
function OAuthDropdownButton({
	icon,
	label,
	disabled,
	highlighted,
	onOAuth,
	onPasteCode,
}: {
	icon: ReactElement;
	label: string;
	disabled: boolean;
	highlighted?: boolean;
	onOAuth: () => void;
	onPasteCode: () => void;
}): ReactElement {
	return (
		<DropdownMenu.Root>
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
				/>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-50 min-w-[11rem] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
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
export function JackedAccountActions({
	account,
	online,
	busy,
	isFirst,
	isLast,
	onReauth,
	onReauthRemote,
	onAuthorizeCc,
	onAuthorizeCcRemote,
	onValidate,
	onToggleEnabled,
	onDelete,
	onMoveUp,
	onMoveDown,
}: JackedAccountActionsProps): ReactElement {
	const [confirmDelete, setConfirmDelete] = useState(false);
	const disabled = !online || busy;
	const label = account.displayName ?? account.email;

	return (
		<div className="mt-1 flex items-center gap-0.5" data-testid={`jacked-account-actions-${account.id}`}>
			<Tooltip content="Re-run Claude OAuth for this account">
				<span>
					<OAuthDropdownButton
						icon={<KeyRound size={10} />}
						label={`Re-authenticate ${label}`}
						disabled={disabled}
						onOAuth={onReauth}
						onPasteCode={onReauthRemote}
					/>
				</span>
			</Tooltip>
			<Tooltip
				content={
					account.hasCcToken
						? "Re-run Claude Code token authorization for this account"
						: "Claude Code tokens missing — authorize now or credentials expire in ~8 hours with no way to renew"
				}
			>
				<span>
					<OAuthDropdownButton
						icon={<ShieldAlert size={10} />}
						label={`Authorize Claude Code tokens for ${label}`}
						disabled={disabled}
						highlighted={!account.hasCcToken}
						onOAuth={onAuthorizeCc}
						onPasteCode={onAuthorizeCcRemote}
					/>
				</span>
			</Tooltip>
			<Tooltip content="Check the stored credential without switching to it">
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onValidate}
					icon={<BadgeCheck size={10} />}
					className="h-6 px-1.5 text-[10px]"
					aria-label={`Validate ${label}`}
				/>
			</Tooltip>
			<Tooltip content={account.isActive ? "Disable (excluded from auto-swap)" : "Enable for auto-swap"}>
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={onToggleEnabled}
					icon={<Power size={10} />}
					className={account.isActive ? "h-6 px-1.5 text-[10px]" : "h-6 px-1.5 text-[10px] text-text-tertiary"}
					aria-label={account.isActive ? `Disable ${label}` : `Enable ${label}`}
				/>
			</Tooltip>
			<span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
			<Tooltip content="Higher auto-swap priority">
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled || isFirst}
					onClick={onMoveUp}
					icon={<ArrowUp size={10} />}
					className="h-6 px-1.5 text-[10px]"
					aria-label={`Raise auto-swap priority of ${label}`}
				/>
			</Tooltip>
			<Tooltip content="Lower auto-swap priority">
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled || isLast}
					onClick={onMoveDown}
					icon={<ArrowDown size={10} />}
					className="h-6 px-1.5 text-[10px]"
					aria-label={`Lower auto-swap priority of ${label}`}
				/>
			</Tooltip>
			<Tooltip content="Remove this account from jacked">
				<Button
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => setConfirmDelete(true)}
					icon={<Trash2 size={10} />}
					className="ml-auto h-6 px-1.5 text-[10px] text-status-red"
					aria-label={`Delete ${label}`}
				/>
			</Tooltip>
			<AlertDialog
				open={confirmDelete}
				onOpenChange={(isOpen) => {
					if (!isOpen) {
						setConfirmDelete(false);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove {label} from jacked?</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription>
						Tasks pinned to this account fall back to the active account on their next start.
					</AlertDialogDescription>
					<p className="text-text-primary">
						This removes the stored credential from jacked. Your Claude subscription is untouched, and you can
						add the account again with OAuth.
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
