/**
 * @deprecated Re-exported for backward compatibility. Use LoginGateProvider from @/components/login-gate.
 */
export {
	LoginGateProvider as PasscodeGateProvider,
	LoginGate as PasscodeGate,
	useAuth,
} from "./login-gate";
export type { AuthStatusResponse as PasscodeStatusResponse } from "./login-gate";
