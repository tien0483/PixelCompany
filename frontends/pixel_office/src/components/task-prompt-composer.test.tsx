import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskPromptComposer } from "@/components/task-prompt-composer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TaskImage } from "@/types";

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: { searchFiles: { query: vi.fn().mockResolvedValue({ files: [] }) } },
	}),
}));

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makePngFile(name: string): File {
	const bytes = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0));
	return new File([bytes], name, { type: "image/png" });
}

function dispatchPaste(textarea: HTMLTextAreaElement, files: File[]): void {
	const event = new Event("paste", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "clipboardData", {
		value: {
			items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
			files,
		},
	});
	textarea.dispatchEvent(event);
}

async function flushPaste(): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	}
}

describe("TaskPromptComposer image markers", () => {
	let container: HTMLDivElement;
	let root: Root;
	let latestImages: TaskImage[] = [];

	function Harness({ initialValue }: { initialValue: string }): React.ReactElement {
		const [value, setValue] = useState(initialValue);
		const [images, setImages] = useState<TaskImage[]>([]);
		latestImages = images;
		return (
			<TooltipProvider>
				<TaskPromptComposer value={value} onValueChange={setValue} images={images} onImagesChange={setImages} />
			</TooltipProvider>
		);
	}

	function textareaEl(): HTMLTextAreaElement {
		const textarea = container.querySelector("textarea");
		if (!textarea) {
			throw new Error("textarea not rendered");
		}
		return textarea;
	}

	beforeEach(() => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		latestImages = [];
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
	});

	it("inserts a marker at the caret instead of appending to the end", async () => {
		act(() => {
			root.render(<Harness initialValue="before after" />);
		});
		const textarea = textareaEl();
		textarea.setSelectionRange(6, 6);

		dispatchPaste(textarea, [makePngFile("shot.png")]);
		await flushPaste();

		expect(textareaEl().value).toBe("before [image: shot.png] after");
		expect(latestImages).toHaveLength(1);
		expect(latestImages[0]?.name).toBe("shot.png");
		// Caret sits right after the inserted marker, so typing continues in place.
		expect(textareaEl().selectionStart).toBe("before [image: shot.png]".length);
	});

	it("gives same-named pastes unique labels", async () => {
		act(() => {
			root.render(<Harness initialValue="" />);
		});

		dispatchPaste(textareaEl(), [makePngFile("image.png")]);
		await flushPaste();
		dispatchPaste(textareaEl(), [makePngFile("image.png")]);
		await flushPaste();

		expect(latestImages.map((image) => image.name)).toEqual(["image.png", "image-2.png"]);
		expect(textareaEl().value).toBe("[image: image.png] [image: image-2.png]");
	});

	it("strips only the removed image's marker", async () => {
		act(() => {
			root.render(<Harness initialValue="" />);
		});

		dispatchPaste(textareaEl(), [makePngFile("first.png"), makePngFile("second.png")]);
		await flushPaste();
		expect(textareaEl().value).toBe("[image: first.png] [image: second.png]");

		const removeButton = container.querySelector<HTMLElement>('[aria-label="Delete first.png"]');
		expect(removeButton).not.toBeNull();
		await act(async () => {
			removeButton?.click();
		});

		expect(latestImages.map((image) => image.name)).toEqual(["second.png"]);
		expect(textareaEl().value).toBe("[image: second.png]");
	});
});
