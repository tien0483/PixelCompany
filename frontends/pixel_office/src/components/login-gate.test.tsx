import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	LoginGate,
	LoginGateProvider,
	PasscodeForm,
	SessionAuthSection,
	useAuth,
	type AuthStatusResponse,
} from "@/components/login-gate";
import { PasscodeGateProvider } from "@/components/passcode-gate";

// Mock globals
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	window.history.pushState({}, "", "/");
	vi.restoreAllMocks();
});

afterEach(() => {
	if (root && container) {
		act(() => {
			root?.unmount();
		});
	}
	container?.remove();
	container = null;
	root = null;
	window.history.pushState({}, "", "/");
	vi.restoreAllMocks();
});

function setInputValue(el: HTMLInputElement, value: string): void {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	setter?.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

function TestConsumer() {
	const auth = useAuth();
	return (
		<div data-testid="test-consumer">
			<span data-testid="auth-mode">{auth.mode}</span>
			<span data-testid="auth-authenticated">{String(auth.authenticated)}</span>
			{auth.subject && <span data-testid="auth-subject-email">{auth.subject.email}</span>}
		</div>
	);
}

describe("LoginGateProvider", () => {
	it("renders children immediately when mode is off", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "off",
			required: false,
			authenticated: true,
			passcodeAvailable: false,
			google: { configured: false },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<div data-testid="child-content">App Content</div>
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='child-content']")).toBeTruthy();
		expect(container?.querySelector("[data-testid='login-gate']")).toBeFalsy();
	});

	it("renders children when authenticated in passcode mode", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "passcode",
			required: true,
			authenticated: true,
			passcodeAvailable: true,
			google: { configured: false },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<div data-testid="child-content">App Content</div>
					<TestConsumer />
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='child-content']")).toBeTruthy();
		expect(container?.querySelector("[data-testid='auth-mode']")?.textContent).toBe("passcode");
		expect(container?.querySelector("[data-testid='auth-authenticated']")?.textContent).toBe("true");
	});

	it("renders passcode gate when unauthenticated in passcode mode", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "passcode",
			required: true,
			authenticated: false,
			passcodeAvailable: true,
			google: { configured: false },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<div data-testid="child-content">App Content</div>
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='child-content']")).toBeFalsy();
		expect(container?.querySelector("[data-testid='login-gate']")).toBeTruthy();
		expect(container?.querySelector("input[type='password']")).toBeTruthy();
		expect(container?.textContent).toContain("Remote Access");
	});

	it("renders Google button in google mode", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "google",
			required: true,
			authenticated: false,
			passcodeAvailable: true,
			google: { configured: true },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<div data-testid="child-content">App Content</div>
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='child-content']")).toBeFalsy();
		expect(container?.querySelector("[data-testid='google-login-button']")).toBeTruthy();
		expect(container?.textContent).toContain("Continue with Google");
		expect(container?.querySelector("[data-testid='toggle-passcode-button']")).toBeTruthy();
	});

	it("falls back gracefully when fetch fails", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network failure"));

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<div data-testid="child-content">Fallback Children</div>
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='child-content']")).toBeTruthy();
	});
});

describe("LoginGate Component", () => {
	it("expands collapsible recovery passcode form in google mode", async () => {
		const status: AuthStatusResponse = {
			mode: "google",
			required: true,
			authenticated: false,
			passcodeAvailable: true,
			google: { configured: true },
		};

		await act(async () => {
			root?.render(<LoginGate status={status} onAuthenticated={vi.fn()} />);
		});

		expect(container?.querySelector("[data-testid='collapsible-passcode-section']")).toBeFalsy();

		const toggleBtn = container?.querySelector("[data-testid='toggle-passcode-button']") as HTMLButtonElement;
		expect(toggleBtn).toBeTruthy();

		await act(async () => {
			toggleBtn.click();
		});

		expect(container?.querySelector("[data-testid='collapsible-passcode-section']")).toBeTruthy();
		expect(container?.querySelector("input[aria-label='Recovery passcode']")).toBeTruthy();
	});

	it("displays auth error alert from URL query param", async () => {
		window.history.pushState({}, "", "/?auth_error=email_not_allowed");

		const status: AuthStatusResponse = {
			mode: "google",
			required: true,
			authenticated: false,
			passcodeAvailable: true,
			google: { configured: true },
		};

		await act(async () => {
			root?.render(<LoginGate status={status} onAuthenticated={vi.fn()} />);
		});

		const alert = container?.querySelector("[data-testid='auth-error-alert']");
		expect(alert).toBeTruthy();
		expect(alert?.textContent).toContain("allowed users list");
	});
});

describe("PasscodeForm", () => {
	it("submits passcode and calls onAuthenticated on success", async () => {
		const onAuth = vi.fn();
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		} as Response);

		await act(async () => {
			root?.render(<PasscodeForm onAuthenticated={onAuth} />);
		});

		const input = container?.querySelector("input") as HTMLInputElement;
		const form = container?.querySelector("form") as HTMLFormElement;

		await act(async () => {
			setInputValue(input, "valid-passcode");
		});

		await act(async () => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"/api/passcode/verify",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ passcode: "valid-passcode" }),
			}),
		);
		expect(onAuth).toHaveBeenCalled();
	});

	it("displays error message on incorrect passcode", async () => {
		const onAuth = vi.fn();
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: async () => ({ error: "Invalid passcode" }),
		} as Response);

		await act(async () => {
			root?.render(<PasscodeForm onAuthenticated={onAuth} />);
		});

		const input = container?.querySelector("input") as HTMLInputElement;
		const form = container?.querySelector("form") as HTMLFormElement;

		await act(async () => {
			setInputValue(input, "wrong-passcode");
		});

		await act(async () => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});

		// Wait for MIN_ERROR_DISPLAY_MS (800ms) to elapse
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 850));
		});

		expect(container?.querySelector("[data-testid='passcode-error']")).toBeTruthy();
		expect(container?.querySelector("[data-testid='passcode-error']")?.textContent).toContain("Incorrect passcode");
		expect(onAuth).not.toHaveBeenCalled();
	});

	it("handles 429 rate limit with lockout timer", async () => {
		const onAuth = vi.fn();
		const headers = new Headers();
		headers.set("Retry-After", "15");
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: false,
			status: 429,
			headers,
			json: async () => ({ error: "Rate limit exceeded" }),
		} as unknown as Response);

		await act(async () => {
			root?.render(<PasscodeForm onAuthenticated={onAuth} />);
		});

		const input = container?.querySelector("input") as HTMLInputElement;
		const form = container?.querySelector("form") as HTMLFormElement;

		await act(async () => {
			setInputValue(input, "spam-passcode");
		});

		await act(async () => {
			form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		});

		expect(container?.querySelector("[data-testid='passcode-lockout']")).toBeTruthy();
		expect(container?.querySelector("[data-testid='passcode-lockout']")?.textContent).toContain("15s");
		expect(onAuth).not.toHaveBeenCalled();
	});
});

describe("SessionAuthSection", () => {
	it("renders subject information and logout button when authenticated", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "google",
			required: true,
			authenticated: true,
			passcodeAvailable: true,
			google: { configured: true },
			subject: {
				name: "Alice Engineer",
				email: "alice@company.com",
				picture: "https://example.com/alice.png",
			},
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<SessionAuthSection />
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='session-auth-section']")).toBeTruthy();
		expect(container?.querySelector("[data-testid='session-user-name']")?.textContent).toBe("Alice Engineer");
		expect(container?.querySelector("[data-testid='session-user-email']")?.textContent).toBe("alice@company.com");
		const avatar = container?.querySelector("[data-testid='session-user-avatar']") as HTMLImageElement;
		expect(avatar?.src).toBe("https://example.com/alice.png");
		expect(container?.querySelector("[data-testid='logout-button']")).toBeTruthy();
	});

	it("returns null when auth mode is off", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "off",
			required: false,
			authenticated: true,
			passcodeAvailable: false,
			google: { configured: false },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<LoginGateProvider>
					<SessionAuthSection />
				</LoginGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='session-auth-section']")).toBeFalsy();
	});
});

describe("PasscodeGateProvider backward compatibility shim", () => {
	it("mounts and renders correctly using the PasscodeGateProvider export", async () => {
		const mockStatus: AuthStatusResponse = {
			mode: "off",
			required: false,
			authenticated: true,
			passcodeAvailable: false,
			google: { configured: false },
		};

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			json: async () => mockStatus,
		} as Response);

		await act(async () => {
			root?.render(
				<PasscodeGateProvider>
					<div data-testid="shim-child">Shim Content</div>
				</PasscodeGateProvider>,
			);
		});

		expect(container?.querySelector("[data-testid='shim-child']")).toBeTruthy();
	});
});
