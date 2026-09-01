import {
	AlertCircle,
	ChevronDown,
	ChevronUp,
	KeyRound,
	Loader2,
	LogOut,
	ShieldCheck,
	User,
} from "lucide-react";
import {
	createContext,
	type FormEvent,
	type ReactElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthMode = "off" | "passcode" | "google";

export interface AuthSubject {
	email?: string;
	name?: string;
	picture?: string;
}

export interface AuthStatusResponse {
	mode: AuthMode;
	required: boolean;
	authenticated: boolean;
	passcodeAvailable: boolean;
	google: {
		configured: boolean;
	};
	subject?: AuthSubject;
}

export interface AuthContextValue {
	mode: AuthMode;
	required: boolean;
	authenticated: boolean;
	passcodeAvailable: boolean;
	googleConfigured: boolean;
	subject: AuthSubject | null;
	logout: () => Promise<void>;
	refresh: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		return {
			mode: "off",
			required: false,
			authenticated: true,
			passcodeAvailable: false,
			googleConfigured: false,
			subject: null,
			logout: async () => {},
			refresh: async () => {},
		};
	}
	return context;
}

// ── SVG Brand & Icons ─────────────────────────────────────────────────────────

export function PixtielWordmark({ className = "h-7 w-auto" }: { className?: string }): ReactElement {
	return (
		<svg
			viewBox="0 0 160 36"
			className={className}
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-label="PIXTiel"
		>
			<defs>
				<linearGradient id="pixtiel-gate-grad" x1="0%" y1="0%" x2="100%" y2="0%">
					<stop offset="0%" stopColor="#0084FF" />
					<stop offset="100%" stopColor="#26D0A8" />
				</linearGradient>
			</defs>
			<text
				x="80"
				y="26"
				textAnchor="middle"
				fill="url(#pixtiel-gate-grad)"
				fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
				fontWeight="800"
				fontSize="24"
				letterSpacing="1.2"
			>
				PIXTiel
			</text>
		</svg>
	);
}

function GoogleIcon({ className = "h-4 w-4" }: { className?: string }): ReactElement {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true">
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
			/>
		</svg>
	);
}

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Wraps children with the unified login gate. On mount it checks
 * `/api/auth/status`; if authentication is required and the visitor
 * hasn't authenticated yet, it renders the gate screen (Google and/or Passcode).
 * When mode is "off" or session is authenticated, children are rendered immediately.
 */
export function LoginGateProvider({ children }: { children: ReactNode }): ReactElement {
	const [status, setStatus] = useState<AuthStatusResponse | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchStatus = useCallback(async () => {
		try {
			const res = await fetch("/api/auth/status", { credentials: "same-origin" });
			if (res.ok) {
				const data = (await res.json()) as AuthStatusResponse;
				setStatus(data);
			} else {
				setStatus({
					mode: "off",
					required: false,
					authenticated: true,
					passcodeAvailable: false,
					google: { configured: false },
				});
			}
		} catch {
			setStatus({
				mode: "off",
				required: false,
				authenticated: true,
				passcodeAvailable: false,
				google: { configured: false },
			});
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchStatus();
	}, [fetchStatus]);

	const logout = useCallback(async () => {
		try {
			await fetch("/api/auth/logout", {
				method: "POST",
				credentials: "same-origin",
			});
		} finally {
			window.location.reload();
		}
	}, []);

	const authValue = useMemo<AuthContextValue>(() => {
		return {
			mode: status?.mode ?? "off",
			required: status?.required ?? false,
			authenticated: status?.authenticated ?? true,
			passcodeAvailable: status?.passcodeAvailable ?? false,
			googleConfigured: status?.google?.configured ?? false,
			subject: status?.subject ?? null,
			logout,
			refresh: fetchStatus,
		};
	}, [status, logout, fetchStatus]);

	if (loading) return <></>;

	const isGated = status && status.required && !status.authenticated;

	if (isGated) {
		return (
			<AuthContext.Provider value={authValue}>
				<LoginGate status={status} onAuthenticated={() => window.location.reload()} />
			</AuthContext.Provider>
		);
	}

	return <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>;
}

// ── Passcode Form ─────────────────────────────────────────────────────────────

interface PasscodeFormProps {
	onAuthenticated: () => void;
	isRecovery?: boolean;
}

type GateState = "idle" | "submitting" | "error" | "locked";
const MIN_ERROR_DISPLAY_MS = 800;

export function PasscodeForm({ onAuthenticated, isRecovery = false }: PasscodeFormProps): ReactElement {
	const [passcode, setPasscode] = useState("");
	const [state, setState] = useState<GateState>("idle");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [lockoutSeconds, setLockoutSeconds] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		if (!isRecovery) {
			inputRef.current?.focus();
		}
	}, [isRecovery]);

	useEffect(() => {
		return () => {
			if (lockoutTimerRef.current) {
				clearInterval(lockoutTimerRef.current);
			}
		};
	}, []);

	const startLockoutCountdown = useCallback((seconds: number) => {
		setLockoutSeconds(seconds);
		setState("locked");
		lockoutTimerRef.current = setInterval(() => {
			setLockoutSeconds((prev) => {
				if (prev <= 1) {
					if (lockoutTimerRef.current) {
						clearInterval(lockoutTimerRef.current);
						lockoutTimerRef.current = null;
					}
					setState("idle");
					setErrorMessage(null);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
	}, []);

	const handleSubmit = useCallback(
		async (e: FormEvent) => {
			e.preventDefault();
			if (state === "submitting" || state === "locked") return;
			if (!passcode.trim()) return;

			setState("submitting");
			setErrorMessage(null);

			const submitStart = Date.now();

			try {
				const response = await fetch("/api/passcode/verify", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ passcode: passcode.trim() }),
					credentials: "same-origin",
				});

				if (response.ok) {
					onAuthenticated();
					return;
				}

				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 30;
					startLockoutCountdown(Number.isFinite(seconds) ? seconds : 30);
					setErrorMessage("Too many failed attempts. Please wait before trying again.");
					setPasscode("");
					return;
				}

				const elapsed = Date.now() - submitStart;
				const remaining = MIN_ERROR_DISPLAY_MS - elapsed;
				if (remaining > 0) {
					await new Promise((resolve) => setTimeout(resolve, remaining));
				}

				setErrorMessage("Incorrect passcode. Please try again.");
				setState("error");
				setPasscode("");
				inputRef.current?.focus();
			} catch {
				setErrorMessage("Could not connect to the server. Please try again.");
				setState("error");
			}
		},
		[passcode, state, onAuthenticated, startLockoutCountdown],
	);

	const isDisabled = state === "submitting" || state === "locked";

	return (
		<form onSubmit={(e) => void handleSubmit(e)} className="space-y-3" data-testid="passcode-form">
			<div>
				<input
					ref={inputRef}
					type="password"
					value={passcode}
					onChange={(e) => {
						setPasscode(e.target.value);
						if (state === "error") setState("idle");
						setErrorMessage(null);
					}}
					placeholder={isRecovery ? "Recovery passcode" : "Passcode"}
					disabled={isDisabled}
					autoComplete="one-time-code"
					aria-label={isRecovery ? "Recovery passcode" : "Passcode"}
					className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:opacity-50"
				/>
			</div>

			{errorMessage && (
				<p className="text-xs text-status-red" role="alert" data-testid="passcode-error">
					{errorMessage}
				</p>
			)}

			{state === "locked" && lockoutSeconds > 0 && (
				<p className="text-xs text-text-secondary" data-testid="passcode-lockout">
					Try again in {lockoutSeconds}s
				</p>
			)}

			<Button
				type="submit"
				variant="primary"
				fill
				disabled={isDisabled || !passcode.trim()}
				icon={
					state === "submitting" ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<ShieldCheck size={14} />
					)
				}
			>
				{state === "submitting"
					? "Verifying…"
					: isRecovery
						? "Sign in with passcode"
						: "Access PIXTiel"}
			</Button>
		</form>
	);
}

// ── Gate Screen ───────────────────────────────────────────────────────────────

export interface LoginGateProps {
	status: AuthStatusResponse;
	onAuthenticated: () => void;
}

function resolveAuthErrorMessage(code: string | null): string | null {
	if (!code) return null;
	switch (code) {
		case "email_not_allowed":
			return "Access denied: Your Google account is not in the allowed users list.";
		case "missing_code":
			return "Authentication failed: Missing authorization code from Google.";
		case "invalid_state":
			return "Authentication failed: Invalid or expired state token. Please try again.";
		case "exchange_failed":
			return "Authentication failed: Could not exchange token with Google. Please try again.";
		default:
			return "Authentication failed. Please try again.";
	}
}

export function LoginGate({ status, onAuthenticated }: LoginGateProps): ReactElement {
	const [showPasscode, setShowPasscode] = useState(false);
	const [authError, setAuthError] = useState<string | null>(null);

	useEffect(() => {
		try {
			const params = new URLSearchParams(window.location.search);
			const err = params.get("auth_error");
			if (err) {
				setAuthError(resolveAuthErrorMessage(err));
			}
		} catch {
			// Ignore URL parsing errors
		}
	}, []);

	const isGoogleMode = status.mode === "google";

	return (
		<div className="flex min-h-screen items-center justify-center bg-surface-0 p-6" data-testid="login-gate">
			<div className="w-full max-w-sm">
				<div className="rounded-xl border border-border bg-surface-1 p-6 shadow-2xl">
					{/* Brand Header */}
					<div className="mb-6 flex flex-col items-center text-center">
						<div className="mb-2 flex items-center justify-center">
							<PixtielWordmark className="h-8 w-auto" />
						</div>
						<h1 className="text-base font-semibold text-text-primary">
							{isGoogleMode ? "Sign in to PIXTiel" : "Remote Access"}
						</h1>
						<p className="mt-0.5 text-xs text-text-secondary">
							{isGoogleMode
								? "Authenticate with your authorized account"
								: "Enter the passcode to continue"}
						</p>
					</div>

					{/* Error alert from URL callback */}
					{authError && (
						<div
							className="mb-4 flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 p-3 text-xs text-status-red"
							role="alert"
							data-testid="auth-error-alert"
						>
							<AlertCircle size={15} className="shrink-0 mt-0.5" />
							<div>{authError}</div>
						</div>
					)}

					{/* Google Mode */}
					{isGoogleMode && (
						<div className="space-y-4">
							<Button
								type="button"
								variant="primary"
								fill
								onClick={() => {
									window.location.href = "/api/auth/google/start";
								}}
								icon={<GoogleIcon />}
								className="h-10 text-sm font-medium"
								data-testid="google-login-button"
							>
								Continue with Google
							</Button>

							{status.passcodeAvailable && (
								<div className="pt-2">
									<div className="relative my-3">
										<div className="absolute inset-0 flex items-center">
											<div className="w-full border-t border-border" />
										</div>
										<div className="relative flex justify-center text-xs">
											<span className="bg-surface-1 px-2 text-text-tertiary">or</span>
										</div>
									</div>

									<button
										type="button"
										onClick={() => setShowPasscode((prev) => !prev)}
										className="flex w-full items-center justify-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors py-1 cursor-pointer"
										aria-expanded={showPasscode}
										data-testid="toggle-passcode-button"
									>
										<span>Use recovery passcode</span>
										{showPasscode ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
									</button>

									{showPasscode && (
										<div className="mt-3 pt-1" data-testid="collapsible-passcode-section">
											<PasscodeForm onAuthenticated={onAuthenticated} isRecovery />
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* Passcode Mode */}
					{!isGoogleMode && (
						<div className="space-y-4">
							<div className="mb-2 flex items-center gap-3">
								<div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
									<KeyRound size={16} />
								</div>
								<div className="text-xs text-text-secondary">
									A secure session token will be issued upon verification.
								</div>
							</div>
							<PasscodeForm onAuthenticated={onAuthenticated} />
						</div>
					)}
				</div>

				<p className="mt-3 text-center text-xs text-text-tertiary">
					{isGoogleMode
						? "Only users in the configured allowlist can access this instance."
						: "The passcode was printed to the console when PIXTiel started."}
				</p>
			</div>
		</div>
	);
}

// ── Settings / Menu Affordance ────────────────────────────────────────────────

/**
 * Session status component to be placed inside the Settings dialog or header menu.
 * Surfaces the authenticated subject (name, email, avatar) and provides a Logout button.
 */
export function SessionAuthSection(): ReactElement | null {
	const { mode, authenticated, subject, logout } = useAuth();
	const [loggingOut, setLoggingOut] = useState(false);

	if (mode === "off" || !authenticated) {
		return null;
	}

	const handleLogout = async () => {
		setLoggingOut(true);
		try {
			await logout();
		} catch {
			setLoggingOut(false);
		}
	};

	return (
		<div className="rounded-lg border border-border bg-surface-0 px-4 py-3 mb-4" data-testid="session-auth-section">
			<div className="flex items-center justify-between gap-4">
				<div className="flex items-center gap-3 min-w-0">
					{subject?.picture ? (
						<img
							src={subject.picture}
							alt={subject.name || subject.email || "User avatar"}
							className="h-9 w-9 rounded-full object-cover border border-border"
							referrerPolicy="no-referrer"
							data-testid="session-user-avatar"
						/>
					) : (
						<div
							className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent border border-accent/20 shrink-0"
							data-testid="session-user-avatar-fallback"
						>
							<User size={18} />
						</div>
					)}
					<div className="min-w-0">
						{subject?.name && (
							<div className="text-sm font-medium text-text-primary truncate" data-testid="session-user-name">
								{subject.name}
							</div>
						)}
						{subject?.email && (
							<div className="text-xs text-text-secondary truncate" data-testid="session-user-email">
								{subject.email}
							</div>
						)}
						{!subject?.email && !subject?.name && (
							<div className="text-sm font-medium text-text-primary">
								{mode === "passcode" ? "Passcode Session" : "Active Session"}
							</div>
						)}
						<div className="text-[11px] text-text-tertiary">
							Auth mode: <span className="font-mono text-text-secondary">{mode}</span>
						</div>
					</div>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => void handleLogout()}
					disabled={loggingOut}
					icon={loggingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
					className="text-status-red hover:bg-status-red/10 shrink-0"
					data-testid="logout-button"
				>
					{loggingOut ? "Signing out…" : "Log out"}
				</Button>
			</div>
		</div>
	);
}
