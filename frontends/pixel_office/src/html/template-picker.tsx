import type { ReactElement } from "react";

import { cn } from "@/components/ui/cn";
import { HTML_LABELS } from "@/html/html-labels";
import type { HtmlTemplateMeta } from "@/html/use-html-templates";

const SCENARIO_ORDER = [
	"marketing",
	"design",
	"product",
	"engineering",
	"operations",
	"creator",
	"finance",
	"education",
	"personal",
	"hr",
	"sales",
	"video",
];

function scenarioLabel(scenario: string): string {
	return scenario.charAt(0).toUpperCase() + scenario.slice(1);
}

export interface TemplatePickerProps {
	templates: HtmlTemplateMeta[];
	selectedId: string | null;
	onSelect: (id: string) => void;
	disabled?: boolean;
	online: boolean;
}

export function TemplatePicker({
	templates,
	selectedId,
	onSelect,
	disabled,
	online,
}: TemplatePickerProps): ReactElement {
	if (!online) {
		return (
			<div className="rounded-md border border-border bg-surface-2 px-3 py-4 text-sm text-text-secondary">
				<div className="font-medium text-text-primary">{HTML_LABELS.offline}</div>
				<div className="mt-1 text-text-tertiary">{HTML_LABELS.offlineHint}</div>
			</div>
		);
	}

	if (templates.length === 0) {
		return (
			<div className="px-1 py-3 text-sm text-text-secondary">{HTML_LABELS.emptyTemplates}</div>
		);
	}

	const byScenario = new Map<string, HtmlTemplateMeta[]>();
	for (const template of templates) {
		const key = template.scenario || "other";
		const list = byScenario.get(key) ?? [];
		list.push(template);
		byScenario.set(key, list);
	}
	const orderedKeys = [
		...SCENARIO_ORDER.filter((key) => byScenario.has(key)),
		...[...byScenario.keys()].filter((key) => !SCENARIO_ORDER.includes(key)).sort(),
	];

	return (
		<div className="flex min-h-0 flex-col gap-3 overflow-auto" data-testid="html-template-picker">
			{orderedKeys.map((scenario) => {
				const group = byScenario.get(scenario) ?? [];
				return (
					<div key={scenario}>
						<div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
							{scenarioLabel(scenario)}
						</div>
						<div className="grid gap-1.5">
							{group.map((template) => {
								const selected = template.id === selectedId;
								return (
									<button
										key={template.id}
										type="button"
										disabled={disabled}
										onClick={() => onSelect(template.id)}
										className={cn(
											"flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
											selected
												? "border-accent bg-surface-3"
												: "border-border bg-surface-2 hover:bg-surface-3",
											disabled ? "opacity-50" : "cursor-pointer",
										)}
										data-testid={`html-template-${template.id}`}
									>
										<span className="text-base leading-none" aria-hidden>
											{template.emoji || "◇"}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-sm font-medium text-text-primary">
												{template.enName || template.zhName || template.id}
											</span>
											<span className="mt-0.5 block line-clamp-2 text-[11px] text-text-secondary">
												{template.description}
											</span>
										</span>
									</button>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
