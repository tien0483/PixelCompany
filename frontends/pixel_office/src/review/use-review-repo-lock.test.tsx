import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	type ReviewRepoLock,
	reviewRepoLockStorageKey,
	useReviewRepoLock,
} from "@/review/use-review-repo-lock";

const HOST = "gitlab.example.com";
const KEY = reviewRepoLockStorageKey(HOST, 42);

describe("useReviewRepoLock", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let latest: ReviewRepoLock | null;

	function Probe({ projectId, shellRepoPath }: { projectId: number; shellRepoPath: string | undefined }): null {
		latest = useReviewRepoLock({ host: HOST, projectId, shellRepoPath });
		return null;
	}

	async function render(
		overrides: { projectId?: number; shellRepoPath?: string | undefined } = {},
	): Promise<void> {
		const element: ReactElement = (
			<Probe
				projectId={overrides.projectId ?? 42}
				shellRepoPath={"shellRepoPath" in overrides ? overrides.shellRepoPath : "/repos/shell"}
			/>
		);
		await act(async () => {
			root.render(element);
		});
	}

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		latest = null;
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		vi.restoreAllMocks();
		container.remove();
		window.localStorage.clear();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("captures the shell's project the first time a merge request is opened", async () => {
		await render({ shellRepoPath: "/repos/shell" });
		expect(latest?.lockedPath).toBe("/repos/shell");
		expect(window.localStorage.getItem(KEY)).toBe("/repos/shell");
	});

	it("does not re-capture when the shell switches project", async () => {
		await render({ shellRepoPath: "/repos/shell" });
		await render({ shellRepoPath: "/repos/other" });
		// The whole point: a sidebar switch must not repoint the review's repository.
		expect(latest?.lockedPath).toBe("/repos/shell");
		expect(window.localStorage.getItem(KEY)).toBe("/repos/shell");
	});

	it("honours a stored pin over the shell's project", async () => {
		window.localStorage.setItem(KEY, "/repos/pinned");
		await render({ shellRepoPath: "/repos/shell" });
		expect(latest?.lockedPath).toBe("/repos/pinned");
	});

	it("re-pins on an explicit lock", async () => {
		await render();
		await act(async () => {
			latest?.lock("/repos/picked");
		});
		expect(latest?.lockedPath).toBe("/repos/picked");
		expect(window.localStorage.getItem(KEY)).toBe("/repos/picked");
	});

	it("keeps an unlock across a re-render rather than re-capturing", async () => {
		await render({ shellRepoPath: "/repos/shell" });
		await act(async () => {
			latest?.unlock();
		});
		expect(latest?.lockedPath).toBeNull();
		// Stored as a sentinel, not removed: an absent key means "never chosen", which is
		// what triggers the auto-capture, so removing it would re-pin on the next render.
		await render({ shellRepoPath: "/repos/other" });
		expect(latest?.lockedPath).toBeNull();
	});

	it("keys the pin per GitLab project, not per host", async () => {
		window.localStorage.setItem(reviewRepoLockStorageKey(HOST, 42), "/repos/a");
		window.localStorage.setItem(reviewRepoLockStorageKey(HOST, 43), "/repos/b");
		await render({ projectId: 43 });
		expect(latest?.lockedPath).toBe("/repos/b");
	});

	it("falls back to following the shell when storage is unreadable", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("denied");
		});
		await render({ shellRepoPath: "/repos/shell" });
		expect(latest?.lockedPath).toBeNull();
	});

	it("keeps an in-memory pin when storage cannot be written", async () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied");
		});
		await render();
		await act(async () => {
			latest?.lock("/repos/picked");
		});
		expect(latest?.lockedPath).toBe("/repos/picked");
	});

	it("stays unlocked when there is no shell project to capture", async () => {
		await render({ shellRepoPath: undefined });
		expect(latest?.lockedPath).toBeNull();
		expect(window.localStorage.getItem(KEY)).toBeNull();
	});
});
