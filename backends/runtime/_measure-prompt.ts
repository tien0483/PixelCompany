// Throwaway diagnostic: how long is the home-agent command line on Windows?
import { buildWindowsCmdArgsCommandLine } from "./src/core/windows-cmd-launch.js";
import { resolveHomeAgentAppendSystemPrompt } from "./src/prompts/append-system-prompt.js";

for (const id of ["__home_agent__:ws1:claude"]) {
	const prompt = resolveHomeAgentAppendSystemPrompt(id);
	console.log(`${id} -> ${prompt === null ? "null" : `${prompt.length} chars`}`);
	if (prompt) {
		const line = buildWindowsCmdArgsCommandLine("claude", [
			"--permission-mode",
			"auto",
			"--append-system-prompt",
			prompt,
		]);
		console.log(`  cmd.exe command line: ${line.length} chars (cmd.exe limit is 8191)`);
	}
}
