import { GitCommitHorizontal, GitPullRequestArrow } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
} from "@/components/ui/dialog";

const TEXTAREA_CLASS =
	"w-full resize-none rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none";
const INPUT_CLASS =
	"w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none";

export function CommitComposerDialog({
	open,
	onOpenChange,
	changedFiles,
	onCommit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	changedFiles: number;
	onCommit: (message: string) => Promise<boolean>;
}): React.ReactElement {
	const [message, setMessage] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const close = (): void => {
		setMessage("");
		onOpenChange(false);
	};

	const submit = async (): Promise<void> => {
		if (!message.trim() || isSubmitting) {
			return;
		}
		setIsSubmitting(true);
		const ok = await onCommit(message.trim());
		setIsSubmitting(false);
		if (ok) {
			close();
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
		>
			<DialogHeader
				title="Commit changes"
				icon={<GitCommitHorizontal size={16} />}
			/>
			<DialogBody>
				<p className="mb-2 text-[12px] text-text-secondary">
					Stage all {changedFiles} changed{" "}
					{changedFiles === 1 ? "file" : "files"} and commit.
				</p>
				<textarea
					autoFocus
					rows={4}
					className={TEXTAREA_CLASS}
					placeholder="Commit message"
					value={message}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							void submit();
						}
					}}
				/>
			</DialogBody>
			<DialogFooter>
				<Button variant="default" size="sm" onClick={close}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={!message.trim() || changedFiles === 0 || isSubmitting}
					onClick={() => void submit()}
				>
					Commit
				</Button>
			</DialogFooter>
		</Dialog>
	);
}

export function PullRequestDialog({
	open,
	onOpenChange,
	defaultTitle,
	onCreate,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultTitle?: string;
	onCreate: (
		title: string,
		body: string,
		base?: string,
	) => Promise<{ ok: boolean; url: string | null }>;
}): React.ReactElement {
	const [title, setTitle] = useState(defaultTitle ?? "");
	const [body, setBody] = useState("");
	const [base, setBase] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	const close = (): void => {
		setTitle(defaultTitle ?? "");
		setBody("");
		setBase("");
		onOpenChange(false);
	};

	const submit = async (): Promise<void> => {
		if (!title.trim() || isSubmitting) {
			return;
		}
		setIsSubmitting(true);
		const result = await onCreate(title.trim(), body, base.trim() || undefined);
		setIsSubmitting(false);
		if (result.ok) {
			close();
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
		>
			<DialogHeader
				title="Create pull request"
				icon={<GitPullRequestArrow size={16} />}
			/>
			<DialogBody>
				<label className="mb-3 block">
					<span className="mb-1 block text-[12px] text-text-secondary">
						Title
					</span>
					<input
						autoFocus
						className={INPUT_CLASS}
						placeholder="Pull request title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				</label>
				<label className="mb-3 block">
					<span className="mb-1 block text-[12px] text-text-secondary">
						Description
					</span>
					<textarea
						rows={5}
						className={TEXTAREA_CLASS}
						value={body}
						onChange={(event) => setBody(event.target.value)}
					/>
				</label>
				<label className="block">
					<span className="mb-1 block text-[12px] text-text-secondary">
						Base branch (optional)
					</span>
					<input
						className={INPUT_CLASS}
						placeholder="Default target branch"
						value={base}
						onChange={(event) => setBase(event.target.value)}
					/>
				</label>
			</DialogBody>
			<DialogFooter>
				<Button variant="default" size="sm" onClick={close}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					disabled={!title.trim() || isSubmitting}
					onClick={() => void submit()}
				>
					Create PR
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
