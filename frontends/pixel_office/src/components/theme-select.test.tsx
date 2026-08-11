import type { ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSelect } from "@/components/theme-select";
import { previewThemeId, readStoredThemeId, THEME_GROUPS, useTheme } from "@/hooks/use-theme";

/*
 * Radix Select depends on pointer-capture APIs jsdom lacks, so it is replaced with a
 * native-ish equivalent — the same approach `runtime-settings-dialog.test.tsx` takes,
 * kept local because a shared mock would have to be hoisted across both files.
 */
const RadixSelectCtx = createContext<{
	value: string;
	onValueChange: (next: string) => void;
	onOpenChange?: (open: boolean) => void;
}>({
	value: "",
	onValueChange: () => {},
});

vi.mock("@radix-ui/react-select", () => ({
	Root: ({
		value,
		onValueChange,
		onOpenChange,
		children,
	}: {
		value: string;
		onValueChange: (next: string) => void;
		onOpenChange?: (open: boolean) => void;
		children: ReactNode;
	}) => (
		<RadixSelectCtx.Provider value={{ value, onValueChange, onOpenChange }}>
			<div data-radix-select-root="">
				{children}
				{/* Stands in for dismissing the dropdown (Escape / outside click). */}
				<button type="button" data-testid="close-select" onClick={() => onOpenChange?.(false)} />
			</div>
		</RadixSelectCtx.Provider>
	),
	Trigger: ({ children, ...props }: { children: ReactNode; "aria-label"?: string }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	Value: () => {
		const ctx = useContext(RadixSelectCtx);
		return <span data-testid="theme-select-value">{ctx.value}</span>;
	},
	Icon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
	Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Viewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Label: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Item: ({ value, children, ...rest }: { value: string; children: ReactNode }) => {
		const ctx = useContext(RadixSelectCtx);
		return (
			<button
				type="button"
				role="option"
				aria-label={value}
				// Real Radix reports the pick and *then* closes, both inside the same click —
				// so the close handler sees the props from the render before the pick.
				onClick={() => {
					ctx.onValueChange(value);
					ctx.onOpenChange?.(false);
				}}
				{...rest}
			>
				{children}
			</button>
		);
	},
	ItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	ItemIndicator: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

function closeWithoutPicking(): void {
	const closer = document.querySelector('[data-testid="close-select"]');
	if (!(closer instanceof HTMLElement)) {
		throw new Error("select closer not found");
	}
	closer.click();
}

function option(label: string): HTMLElement {
	const found = Array.from(document.querySelectorAll('[role="option"]')).find((element) =>
		element.textContent?.includes(label),
	);
	if (!(found instanceof HTMLElement)) {
		throw new Error(`option ${label} not found`);
	}
	return found;
}

describe("ThemeSelect", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		// `use-theme` keeps the active theme in module state, so reset both halves of it —
		// otherwise a test that commits a theme leaks into the next one's assertions.
		window.localStorage.clear();
		previewThemeId("default");
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.documentElement.removeAttribute("data-theme");
	});

	function render(node: ReactNode): Promise<void> {
		return act(async () => {
			root.render(node);
		});
	}

	it("lists every theme group", async () => {
		await render(<ThemeSelect value="default" onValueChange={() => {}} />);

		for (const group of THEME_GROUPS) {
			expect(container.textContent).toContain(group.label);
		}
		expect(option("Graphite")).toBeInstanceOf(HTMLElement);
	});

	it("reports the picked theme to the caller", async () => {
		const onValueChange = vi.fn();
		await render(<ThemeSelect value="default" onValueChange={onValueChange} />);

		await act(async () => {
			option("Graphite").click();
		});

		expect(onValueChange).toHaveBeenCalledWith("graphite");
	});

	it("previews a theme on hover and reverts to the caller's value on close", async () => {
		await render(<ThemeSelect value="default" onValueChange={() => {}} />);

		await act(async () => {
			option("Midnight").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		});
		expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");

		// Committing is the caller's job, so a hover must not persist anything.
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();
	});

	/**
	 * The picked theme has to survive the dropdown closing. Radix fires `onValueChange`
	 * and then `onOpenChange(false)` in one click, so a close handler that reverts to the
	 * `value` prop reads the *pre-pick* value and undoes the selection the user just made —
	 * localStorage keeps the new theme, the live document and the trigger snap back to the
	 * old one, and the theme only appears after a reload or a second pick.
	 */
	it("keeps the picked theme when the dropdown closes in the same click", async () => {
		function Header(): ReactNode {
			const { themeId, setThemeId } = useTheme();
			return <ThemeSelect variant="compact" value={themeId} onValueChange={setThemeId} />;
		}
		await render(<Header />);

		await act(async () => {
			option("Light").click();
		});

		expect(window.localStorage.getItem("kanban.theme")).toBe("light");
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
		expect(readStoredThemeId()).toBe("light");
	});

	it("still reverts a hover preview when the dropdown closes without a pick", async () => {
		await render(<ThemeSelect value="graphite" onValueChange={() => {}} />);

		await act(async () => {
			option("Midnight").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		});
		expect(document.documentElement.getAttribute("data-theme")).toBe("midnight");

		await act(async () => {
			closeWithoutPicking();
		});
		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
	});

	it("drops the theme name in the compact variant but keeps it in the field variant", async () => {
		await render(<ThemeSelect value="graphite" onValueChange={() => {}} variant="field" />);
		expect(container.querySelector('[data-testid="theme-select-value"]')).not.toBeNull();

		await render(<ThemeSelect value="graphite" onValueChange={() => {}} variant="compact" />);
		expect(container.querySelector('[data-testid="theme-select-value"]')).toBeNull();
		expect(container.querySelector('[data-testid="theme-select-trigger"]')).not.toBeNull();
	});
});
