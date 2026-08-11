import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Table } from "lucide-react";
import type { ReactElement } from "react";

import type { TextSelectionState } from "@/components/plan-editor/markdown-selection-commands";
import { insertBlock } from "@/components/plan-editor/markdown-selection-commands";
import { MARKDOWN_SNIPPET_GROUPS } from "@/components/plan-editor/markdown-snippets";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export interface PlanSnippetMenuProps {
	disabled?: boolean;
	onCommand: (transform: (state: TextSelectionState) => TextSelectionState) => void;
}

/**
 * Insert-a-premade-block menu for the raw markdown pane. Every item routes through the
 * same `onCommand` the rest of the toolbar uses, so insertion inherits the textarea's
 * cursor restore and the document's debounced autosave.
 */
export function PlanSnippetMenu({ disabled, onCommand }: PlanSnippetMenuProps): ReactElement {
	return (
		<DropdownMenu.Root modal={false}>
			<Tooltip content="Insert block">
				<DropdownMenu.Trigger asChild>
					<Button
						variant="ghost"
						size="sm"
						icon={<Table size={14} />}
						iconRight={<ChevronDown size={8} aria-hidden />}
						aria-label="Insert block"
						disabled={disabled}
						data-testid="plan-editor-snippet-menu"
					/>
				</DropdownMenu.Trigger>
			</Tooltip>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					side="bottom"
					align="start"
					sideOffset={4}
					className="z-[80] min-w-[13rem] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
					// Radix would otherwise pull focus back to the trigger and race the
					// `requestAnimationFrame` focus restore that puts the caret back in the textarea.
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					{MARKDOWN_SNIPPET_GROUPS.map((group, groupIndex) => (
						<div key={group.label}>
							{groupIndex > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
							<DropdownMenu.Label className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
								{group.label}
							</DropdownMenu.Label>
							{group.snippets.map((snippet) => (
								<DropdownMenu.Item
									key={snippet.id}
									className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none data-[highlighted]:bg-surface-3"
									data-testid={`plan-snippet-item-${snippet.id}`}
									onSelect={() => onCommand((state) => insertBlock(state, snippet.content))}
								>
									<p className="font-medium">{snippet.label}</p>
									<p className="text-[10px] text-text-tertiary">{snippet.description}</p>
								</DropdownMenu.Item>
							))}
						</div>
					))}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
