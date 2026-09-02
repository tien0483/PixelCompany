import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { type ReactElement } from "react";

import { formatBytes } from "@/utils/format-bytes";

export interface CleanupNvmVersionEntry {
	version: string;
	path: string;
	sizeBytes: number;
	inUse: boolean;
}

function CheckboxBox({
	checked,
	indeterminate,
	disabled,
	onCheckedChange,
	testId,
}: {
	checked: boolean;
	indeterminate?: boolean;
	disabled?: boolean;
	onCheckedChange: (checked: boolean) => void;
	testId?: string;
}): ReactElement {
	return (
		<RadixCheckbox.Root
			data-testid={testId}
			checked={indeterminate ? "indeterminate" : checked}
			disabled={disabled}
			onCheckedChange={(next) => onCheckedChange(next === true)}
			className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent disabled:cursor-default disabled:opacity-40"
		>
			<RadixCheckbox.Indicator>
				{indeterminate ? (
					<span className="block h-0.5 w-2 bg-white" />
				) : (
					<Check size={10} className="text-white" />
				)}
			</RadixCheckbox.Indicator>
		</RadixCheckbox.Root>
	);
}

export function CleanupNvmVersionsSection({
	versions,
	selectedVersions,
	onToggleVersion,
	onToggleAll,
}: {
	versions: CleanupNvmVersionEntry[];
	selectedVersions: ReadonlySet<string>;
	onToggleVersion: (version: string, checked: boolean) => void;
	onToggleAll: (checked: boolean) => void;
}): ReactElement | null {
	const selectable = versions.filter((entry) => !entry.inUse);
	if (selectable.length === 0) {
		return null;
	}
	const selectedCount = selectable.filter((entry) => selectedVersions.has(entry.version)).length;

	return (
		<div className="ml-6 space-y-2 rounded-md border border-border bg-surface-2 p-2.5">
			<label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer select-none">
				<CheckboxBox
					testId="cleanup-nvm-versions-select-all"
					checked={selectedCount === selectable.length}
					indeterminate={selectedCount > 0 && selectedCount < selectable.length}
					onCheckedChange={onToggleAll}
				/>
				Select removable Node versions
			</label>
			<ul className="max-h-40 space-y-0.5 overflow-y-auto">
				{versions.map((entry) => (
					<li key={entry.version}>
						<label
							className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-text-secondary data-[disabled]:cursor-default data-[disabled]:opacity-40"
							data-disabled={entry.inUse ? "" : undefined}
						>
							<CheckboxBox
								testId={`cleanup-nvm-version-${entry.version}`}
								checked={selectedVersions.has(entry.version)}
								disabled={entry.inUse}
								onCheckedChange={(checked) => onToggleVersion(entry.version, checked)}
							/>
							<span className="font-mono text-text-primary">{entry.version}</span>
							{entry.inUse ? (
								<span className="text-status-orange">in use</span>
							) : null}
							<span className="ml-auto shrink-0">{formatBytes(entry.sizeBytes)}</span>
						</label>
					</li>
				))}
			</ul>
		</div>
	);
}
