import type { ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSelect } from "@/components/theme-select";
import { THEME_GROUPS } from "@/hooks/use-theme";

/*
 * Radix Select depends on pointer-capture APIs jsdom lacks, so it is replaced with a
 * native-ish equivalent — the same approach `runtime-settings-dialog.test.tsx` takes,
 * kept local because a shared mock would have to be hoisted across both files.
 */
const RadixSelectCtx = createContext<{ value: string; onValueChange: (next: string) => void }>({
	value: "",
	onValueChange: () => {},
});

vi.mock("@radix-ui/react-select", () => ({
	Root: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (next: string) => void;
		children: ReactNode;
	}) => (
		<RadixSelectCtx.Provider value={{ value, onValueChange }}>
			<div data-radix-select-root="">{children}</div>
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
			<button type="button" role="option" aria-label={value} onClick={() => ctx.onValueChange(value)} {...rest}>
				{children}
			</button>
		);
	},
	ItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	ItemIndicator: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

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

	it("drops the theme name in the compact variant but keeps it in the field variant", async () => {
		await render(<ThemeSelect value="graphite" onValueChange={() => {}} variant="field" />);
		expect(container.querySelector('[data-testid="theme-select-value"]')).not.toBeNull();

		await render(<ThemeSelect value="graphite" onValueChange={() => {}} variant="compact" />);
		expect(container.querySelector('[data-testid="theme-select-value"]')).toBeNull();
		expect(container.querySelector('[data-testid="theme-select-trigger"]')).not.toBeNull();
	});
});
