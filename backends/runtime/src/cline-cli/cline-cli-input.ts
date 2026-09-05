// The single stdin reader for `kanban cline-agent`.
//
// One readline interface serves both follow-up turns and approval prompts. Two interfaces on the
// same stdin split keystrokes between them at random, and the loser never resolves — so everything
// that needs a line goes through `ask`/`nextLine` here.
import { createInterface, type Interface } from "node:readline";

export interface ClineCliInput {
	/** Prints `question` and resolves with the next line, or null once stdin has closed. */
	ask(question: string): Promise<string | null>;
	/** Next line with no prompt; null once stdin has closed. */
	nextLine(): Promise<string | null>;
	/** Ctrl+C. First press should cancel the turn, second should exit — that policy lives in the caller. */
	onInterrupt(handler: () => void): void;
	close(): void;
}

export function createClineCliInput(options?: {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}): ClineCliInput {
	const input = options?.input ?? process.stdin;
	const output = options?.output ?? process.stdout;
	const rl: Interface = createInterface({ input, output, terminal: true });

	const waiters: Array<(line: string | null) => void> = [];
	const buffered: string[] = [];
	let closed = false;

	rl.on("line", (line) => {
		const waiter = waiters.shift();
		if (waiter) {
			waiter(line);
			return;
		}
		buffered.push(line);
	});

	rl.on("close", () => {
		closed = true;
		while (waiters.length > 0) {
			waiters.shift()?.(null);
		}
	});

	const take = (): Promise<string | null> => {
		const ready = buffered.shift();
		if (ready !== undefined) {
			return Promise.resolve(ready);
		}
		if (closed) {
			return Promise.resolve(null);
		}
		return new Promise((resolve) => {
			waiters.push(resolve);
		});
	};

	return {
		ask(question: string): Promise<string | null> {
			if (closed) {
				return Promise.resolve(null);
			}
			output.write(question);
			return take();
		},
		nextLine(): Promise<string | null> {
			return take();
		},
		onInterrupt(handler: () => void): void {
			// readline swallows SIGINT while `terminal: true`, so this event is the only signal.
			rl.on("SIGINT", handler);
		},
		close(): void {
			if (!closed) {
				rl.close();
			}
		},
	};
}
