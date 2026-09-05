// Tool approval at the terminal.
//
// `createClineRuntimeSetup` already hardcodes approve-all, which is what `--auto-approve-all`
// wants, so this file only covers the interactive case. It borrows the stdin reader from the
// input loop rather than opening its own readline: two readers on one stdin race for keystrokes,
// and the losing one silently never resolves.
import { formatClineToolCallLabel, getClineToolCallDisplay } from "../cline-sdk/cline-tool-call-display";
import type { ClineSdkToolApprovalRequest, ClineSdkToolApprovalResult } from "../cline-sdk/sdk-runtime-boundary";

export interface ClineCliApprovalPrompt {
	/** Resolves with the typed line, or null when stdin closed. */
	ask: (question: string) => Promise<string | null>;
	write: (text: string) => void;
}

export function createAutoApproveToolApproval(): (
	request: ClineSdkToolApprovalRequest,
) => Promise<ClineSdkToolApprovalResult> {
	return async (request) => ({
		approved: true,
		reason: `Approved by --auto-approve-all for ${request.toolName}.`,
	});
}

export function createInteractiveToolApproval(
	prompt: ClineCliApprovalPrompt,
): (request: ClineSdkToolApprovalRequest) => Promise<ClineSdkToolApprovalResult> {
	return async (request) => {
		const display = getClineToolCallDisplay(request.toolName, request.input);
		const label = formatClineToolCallLabel(display.toolName, display.inputSummary);
		const answer = await prompt.ask(`\nApprove ${label}? [y/N] `);
		// stdin closed mid-run (a piped prompt, a detached PTY). Denying is the safe default: the
		// agent is told no and can finish, where hanging would leave a card running forever.
		if (answer === null) {
			prompt.write("\nNo input available — denying tool call.\n");
			return { approved: false, reason: "No interactive input available to approve this tool call." };
		}
		const normalized = answer.trim().toLowerCase();
		if (normalized === "y" || normalized === "yes") {
			return { approved: true, reason: "Approved at the terminal." };
		}
		return { approved: false, reason: "Denied at the terminal." };
	};
}
