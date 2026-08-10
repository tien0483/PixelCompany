import { spawn } from "node:child_process";

interface DirectoryPickerCommandCandidate {
	command: string;
	args: string[];
}

type DirectoryPickerCommandResult =
	| { kind: "selected"; path: string }
	| { kind: "cancelled" }
	| { kind: "unavailable" };

interface SpawnLikeResult {
	error?: Error | undefined;
	signal: NodeJS.Signals | null;
	status: number | null;
	stdout: string | Buffer | null;
	stderr: string | Buffer | null;
}

type RunCommand = (command: string, args: string[]) => SpawnLikeResult | Promise<SpawnLikeResult>;

interface PickDirectoryPathFromSystemDialogOptions {
	platform?: NodeJS.Platform;
	cwd?: string;
	runCommand?: RunCommand;
	env?: NodeJS.ProcessEnv;
}

const WINDOWS_DIRECTORY_PICKER_SCRIPT = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$dialog.Description = 'Select a project folder'",
	"$dialog.ShowNewFolderButton = $false",
	"if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

function parseChildProcessErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return null;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return typeof code === "string" ? code : null;
}

/**
 * Non-blocking spawn. Critical on Windows: FolderBrowserDialog via PowerShell can
 * sit open for minutes; spawnSync would freeze the entire Kanban runtime event loop
 * (all tRPC/WebSocket traffic) until the dialog closed — which looked like
 * "Add Project does nothing" / "Disconnected from Cline".
 */
function defaultRunCommand(command: string, args: string[]): Promise<SpawnLikeResult> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: false,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			resolve({
				error,
				signal: null,
				status: null,
				stdout,
				stderr,
			});
		});
		child.on("close", (status, signal) => {
			resolve({
				error: undefined,
				signal,
				status,
				stdout,
				stderr,
			});
		});
	});
}

async function runDirectoryPickerCommand(
	candidate: DirectoryPickerCommandCandidate,
	runCommand: RunCommand,
): Promise<DirectoryPickerCommandResult> {
	const result = await Promise.resolve(runCommand(candidate.command, candidate.args));

	const errorCode = parseChildProcessErrorCode(result.error);
	if (errorCode === "ENOENT") {
		return { kind: "unavailable" };
	}

	if (result.error) {
		const message = result.error.message || String(result.error);
		throw new Error(`Could not open directory picker via ${candidate.command}: ${message}`);
	}

	if (result.signal) {
		throw new Error(`Directory picker command ${candidate.command} terminated by signal: ${result.signal}`);
	}

	if (result.status !== 0) {
		const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
		if (stderr) {
			const stderrLower = stderr.toLowerCase();
			if (stderrLower.includes("user cancel") || stderrLower.includes("(-128)")) {
				return { kind: "cancelled" };
			}
			throw new Error(`Could not open directory picker via ${candidate.command}: ${stderr}`);
		}
		return { kind: "cancelled" };
	}

	const selectedPath = typeof result.stdout === "string" ? result.stdout.trim() : "";
	if (!selectedPath) {
		return { kind: "cancelled" };
	}

	return { kind: "selected", path: selectedPath };
}

export async function pickDirectoryPathFromSystemDialog(
	options: PickDirectoryPathFromSystemDialogOptions = {},
): Promise<string | null> {
	const platform = options.platform ?? process.platform;
	const cwd = options.cwd ?? process.cwd();
	const runCommand = options.runCommand ?? defaultRunCommand;
	const env = options.env ?? process.env;

	if (platform === "darwin") {
		const result = await runDirectoryPickerCommand(
			{
				command: "osascript",
				args: ["-e", 'POSIX path of (choose folder with prompt "Select a project folder")'],
			},
			runCommand,
		);
		if (result.kind === "selected") {
			return result.path;
		}
		if (result.kind === "cancelled") {
			return null;
		}
		throw new Error('Could not open directory picker. Command "osascript" is not available.');
	}

	if (platform === "linux") {
		// A headless runtime (e.g. WSL2 without WSLg) has no DISPLAY/WAYLAND_DISPLAY, so zenity/kdialog
		// can never draw a window even if installed — spawning them would just hang the caller waiting
		// on a dialog that will never appear. Skip straight to the same "unavailable" outcome used below
		// when zenity/kdialog themselves are missing, so the frontend falls back instantly.
		if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
			throw new Error('Could not open directory picker. Install "zenity" or "kdialog" and try again.');
		}

		const candidates: DirectoryPickerCommandCandidate[] = [
			{
				command: "zenity",
				args: ["--file-selection", "--directory", "--title=Select project folder"],
			},
			{
				command: "kdialog",
				args: ["--getexistingdirectory", cwd, "Select project folder"],
			},
		];

		for (const candidate of candidates) {
			const result = await runDirectoryPickerCommand(candidate, runCommand);
			if (result.kind === "unavailable") {
				continue;
			}
			if (result.kind === "selected") {
				return result.path;
			}
			return null;
		}

		throw new Error('Could not open directory picker. Install "zenity" or "kdialog" and try again.');
	}

	if (platform === "win32") {
		const candidates: DirectoryPickerCommandCandidate[] = [
			{
				command: "powershell",
				args: ["-NoProfile", "-STA", "-Command", WINDOWS_DIRECTORY_PICKER_SCRIPT],
			},
			{
				command: "pwsh",
				args: ["-NoProfile", "-STA", "-Command", WINDOWS_DIRECTORY_PICKER_SCRIPT],
			},
		];

		for (const candidate of candidates) {
			const result = await runDirectoryPickerCommand(candidate, runCommand);
			if (result.kind === "unavailable") {
				continue;
			}
			if (result.kind === "selected") {
				return result.path;
			}
			return null;
		}

		throw new Error('Could not open directory picker. Install PowerShell ("powershell" or "pwsh") and try again.');
	}

	return null;
}
