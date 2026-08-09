// TCP liveness helpers shared by the agent-stack supervisors (switchboard, per-seat CCR).
import { connect } from "node:net";

const PORT_PROBE_TIMEOUT_MS = 1_000;
const PORT_POLL_INTERVAL_MS = 250;

/** True when something is already listening; never rejects. */
export function probePort(host: string, port: number, timeoutMs = PORT_PROBE_TIMEOUT_MS): Promise<boolean> {
	return new Promise((resolvePromise) => {
		const socket = connect({ host, port });
		const finish = (isOpen: boolean) => {
			socket.destroy();
			resolvePromise(isOpen);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}

/**
 * Polls until the port answers, the deadline passes, or the caller says to stop —
 * `shouldKeepWaiting` is how a supervisor bails out the moment its child exits instead of
 * burning the full timeout on a process that is already gone.
 */
export async function waitForPort(
	host: string,
	port: number,
	timeoutMs: number,
	shouldKeepWaiting: () => boolean,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline && shouldKeepWaiting()) {
		if (await probePort(host, port)) {
			return true;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, PORT_POLL_INTERVAL_MS));
	}
	return false;
}
