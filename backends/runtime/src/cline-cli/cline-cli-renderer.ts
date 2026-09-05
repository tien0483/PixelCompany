// Turns `ClineCliObservation`s into terminal output.
//
// Tool lines reuse `formatClineToolCallLabel` / `getClineToolCallDisplay` from the SDK boundary so
// the PTY and the chat panel describe a tool call identically.
//
// The one piece of real state here is `printedAssistantText`: the SDK emits both incremental
// deltas and accumulated/full text for the same turn, so printing every observation verbatim
// duplicates the whole answer. Accumulated text is therefore printed as the suffix past what has
// already been shown.
import { formatClineToolCallLabel, getClineToolCallDisplay } from "../cline-sdk/cline-tool-call-display";
import type { ClineCliObservation } from "./cline-cli-events";

const RESET = "\u001b[0m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const CYAN = "\u001b[36m";
const YELLOW = "\u001b[33m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";

export interface ClineCliRendererOptions {
	write: (text: string) => void;
	/** Reasoning is noisy and most models repeat it in the answer; off unless asked for. */
	showReasoning?: boolean;
	color?: boolean;
}

export interface ClineCliRenderer {
	render(observation: ClineCliObservation): void;
	/** Called when a turn ends so accumulated-text dedup does not leak into the next one. */
	resetTurn(): void;
	/** Emits a trailing newline when the last thing written did not end one. */
	closeLine(): void;
	note(text: string): void;
	warn(text: string): void;
	fail(text: string): void;
}

export function createClineCliRenderer(options: ClineCliRendererOptions): ClineCliRenderer {
	const useColor = options.color ?? true;
	const paint = (code: string, text: string): string => (useColor ? `${code}${text}${RESET}` : text);

	let printedAssistantText = "";
	let printedReasoningText = "";
	let atLineStart = true;

	const write = (text: string): void => {
		if (text.length === 0) {
			return;
		}
		options.write(text);
		atLineStart = text.endsWith("\n");
	};

	const startLine = (): void => {
		if (!atLineStart) {
			write("\n");
		}
	};

	const line = (text: string): void => {
		startLine();
		write(`${text}\n`);
	};

	/** Prints only what is new, so accumulated snapshots do not repeat the whole answer. */
	const writeIncremental = (previous: string, next: string, accumulated: boolean): string => {
		if (!accumulated) {
			write(next);
			return previous + next;
		}
		if (next.startsWith(previous)) {
			write(next.slice(previous.length));
			return next;
		}
		// The turn restarted its text (a retry, or a second content block). Break the line rather
		// than interleaving two answers on one.
		startLine();
		write(next);
		return next;
	};

	return {
		render(observation: ClineCliObservation): void {
			switch (observation.kind) {
				case "assistant-text": {
					printedAssistantText = writeIncremental(printedAssistantText, observation.text, observation.accumulated);
					return;
				}
				case "reasoning-text": {
					if (!options.showReasoning) {
						return;
					}
					const before = printedReasoningText;
					const next = observation.accumulated ? observation.text : printedReasoningText + observation.text;
					if (observation.accumulated && next.startsWith(before)) {
						write(paint(DIM, next.slice(before.length)));
					} else if (!observation.accumulated) {
						write(paint(DIM, observation.text));
					} else {
						startLine();
						write(paint(DIM, next));
					}
					printedReasoningText = next;
					return;
				}
				case "tool-started": {
					const display = getClineToolCallDisplay(observation.toolName, observation.toolInput);
					const label = formatClineToolCallLabel(display.toolName, display.inputSummary);
					line(`${paint(CYAN, "•")} ${paint(BOLD, label)}`);
					// A new tool block ends the assistant paragraph; the next text is a fresh one.
					printedAssistantText = "";
					printedReasoningText = "";
					if (observation.userAttention) {
						line(paint(YELLOW, "  waiting for your reply"));
					}
					return;
				}
				case "tool-finished": {
					const display = getClineToolCallDisplay(observation.toolName, observation.toolInput);
					const label = formatClineToolCallLabel(display.toolName, display.inputSummary);
					if (observation.error) {
						line(`${paint(RED, "✗")} ${label} — ${observation.error}`);
					} else {
						line(`${paint(GREEN, "✓")} ${paint(DIM, label)}`);
					}
					return;
				}
				case "notice": {
					line(paint(DIM, observation.text));
					return;
				}
				case "stream": {
					// stdout/stderr from a tool the SDK is proxying; agent chunks are already covered
					// by the assistant-text observations.
					if (observation.stream === "agent") {
						return;
					}
					write(observation.stream === "stderr" ? paint(DIM, observation.text) : observation.text);
					return;
				}
				case "error": {
					line(
						observation.recoverable
							? paint(YELLOW, `retrying after error: ${observation.message}`)
							: paint(RED, `error: ${observation.message}`),
					);
					return;
				}
				case "turn-finished": {
					if (observation.finalText) {
						printedAssistantText = writeIncremental(printedAssistantText, observation.finalText, true);
					}
					startLine();
					if (observation.status === "aborted") {
						line(paint(YELLOW, "turn interrupted"));
					} else if (observation.status === "failed") {
						line(paint(RED, "turn failed"));
					}
					return;
				}
				case "ended": {
					line(paint(DIM, `session ended (${observation.reason})`));
					return;
				}
				case "status":
					return;
			}
		},
		resetTurn(): void {
			printedAssistantText = "";
			printedReasoningText = "";
		},
		closeLine(): void {
			startLine();
		},
		note(text: string): void {
			line(paint(DIM, text));
		},
		warn(text: string): void {
			line(paint(YELLOW, text));
		},
		fail(text: string): void {
			line(paint(RED, text));
		},
	};
}
