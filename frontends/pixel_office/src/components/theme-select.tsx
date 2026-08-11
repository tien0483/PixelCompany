import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";

import { cn } from "@/components/ui/cn";
import { previewThemeId, THEME_GROUPS, THEMES, type ThemeId } from "@/hooks/use-theme";

/**
 * `field` is the settings dialog's full-width row (swatch + theme name); `compact`
 * is the header control, which drops the name so it fits next to a button.
 */
export type ThemeSelectVariant = "field" | "compact";

export interface ThemeSelectProps {
	value: ThemeId;
	onValueChange: (themeId: ThemeId) => void;
	variant?: ThemeSelectVariant;
}

/** The three-band swatch: darkest surface, then both accents. */
function ThemeSwatch({ themeId }: { themeId: ThemeId }): ReactElement {
	const theme = THEMES.find((entry) => entry.id === themeId);
	return (
		<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
			<span className="flex-1" style={{ background: theme?.surface ?? "#1F2428" }} />
			<span className="flex-1" style={{ background: theme?.accent ?? "#0084FF" }} />
			<span className="flex-1" style={{ background: theme?.accent2 ?? "#7C5CFF" }} />
		</span>
	);
}

/**
 * Theme dropdown, grouped dark / light / high-contrast. Hovering an entry previews
 * it on the live document (`previewThemeId`) and closing without choosing reverts to
 * `value`, so the caller owns what "committed" means: the settings dialog holds a
 * draft until Save, the standalone header persists immediately.
 */
export function ThemeSelect({ value, onValueChange, variant = "field" }: ThemeSelectProps): ReactElement {
	const isCompact = variant === "compact";
	/**
	 * What the close handler reverts to. It cannot read `value` directly: Radix fires
	 * `onValueChange` and then `onOpenChange(false)` inside one click, before React has
	 * re-rendered with the new prop, so `value` there is still the *pre-pick* theme — the
	 * revert then undid the pick, leaving the theme persisted but neither applied to the
	 * document nor shown in the trigger until a reload or a second pick.
	 */
	const committedThemeId = useRef(value);
	useEffect(() => {
		committedThemeId.current = value;
	}, [value]);
	return (
		<RadixSelect.Root
			value={value}
			onValueChange={(next) => {
				committedThemeId.current = next as ThemeId;
				onValueChange(next as ThemeId);
				previewThemeId(next as ThemeId);
			}}
			onOpenChange={(selectOpen) => {
				if (!selectOpen) {
					previewThemeId(committedThemeId.current);
				}
			}}
		>
			<RadixSelect.Trigger
				className={cn(
					"flex cursor-pointer items-center justify-between rounded-md border border-border-bright bg-surface-2 text-[13px] text-text-primary outline-none hover:bg-surface-3 hover:border-border-bright focus:border-border-focus focus:outline-none",
					isCompact ? "h-7 gap-1.5 px-1.5" : "h-9 w-full px-3",
				)}
				aria-label="Theme"
				data-testid="theme-select-trigger"
			>
				<span className="flex items-center gap-2.5">
					<ThemeSwatch themeId={value} />
					{isCompact ? null : <RadixSelect.Value />}
				</span>
				<RadixSelect.Icon>
					<ChevronDown size={14} className="text-text-tertiary" />
				</RadixSelect.Icon>
			</RadixSelect.Trigger>
			<RadixSelect.Portal>
				<RadixSelect.Content
					className={cn(
						"z-50 max-h-72 overflow-auto rounded-lg border border-border bg-surface-1 p-1 shadow-xl",
						isCompact ? "min-w-52" : "w-(--radix-select-trigger-width)",
					)}
					position="popper"
					sideOffset={4}
					align={isCompact ? "end" : "start"}
				>
					<RadixSelect.Viewport>
						{THEME_GROUPS.map((group) => {
							const groupThemes = THEMES.filter((theme) => theme.group === group.key);
							if (groupThemes.length === 0) {
								return null;
							}
							return (
								<RadixSelect.Group key={group.key}>
									<RadixSelect.Label className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
										{group.label}
									</RadixSelect.Label>
									{groupThemes.map((theme) => (
										<RadixSelect.Item
											key={theme.id}
											value={theme.id}
											className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-secondary outline-none data-highlighted:bg-surface-3 data-highlighted:text-text-primary data-[state=checked]:text-text-primary"
											onMouseEnter={() => previewThemeId(theme.id)}
											onFocus={() => previewThemeId(theme.id)}
										>
											<ThemeSwatch themeId={theme.id} />
											<RadixSelect.ItemText>{theme.label}</RadixSelect.ItemText>
											<RadixSelect.ItemIndicator className="ml-auto">
												<Check size={14} className="text-accent-2" />
											</RadixSelect.ItemIndicator>
										</RadixSelect.Item>
									))}
								</RadixSelect.Group>
							);
						})}
					</RadixSelect.Viewport>
				</RadixSelect.Content>
			</RadixSelect.Portal>
		</RadixSelect.Root>
	);
}
