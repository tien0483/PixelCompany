import type { ReactElement } from "react";

import type { RuntimeSavedPlan } from "@/runtime/types";

export function PlanPickerSelect({
	plans,
	value,
	onChange,
	disabled = false,
	id,
}: {
	plans: RuntimeSavedPlan[];
	value: string | null;
	onChange: (planFilePath: string | null) => void;
	disabled?: boolean;
	id?: string;
}): ReactElement {
	return (
		<div>
			<label htmlFor={id} className="text-[11px] text-text-secondary block mb-1">
				Start with plan
			</label>
			<select
				id={id}
				value={value ?? ""}
				disabled={disabled}
				onChange={(event) => {
					const next = event.currentTarget.value;
					onChange(next.length > 0 ? next : null);
				}}
				className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] text-text-primary disabled:opacity-40"
			>
				<option value="">None</option>
				{plans.map((plan) => (
					<option key={plan.id} value={plan.path} disabled={plan.missing === true}>
						{plan.name}
						{plan.missing === true ? " (missing)" : ""}
					</option>
				))}
			</select>
		</div>
	);
}
