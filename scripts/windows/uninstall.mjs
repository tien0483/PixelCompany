/**
 * Remove PixelOffice shortcuts and %LOCALAPPDATA%\PixelOffice (optional --keep-config).
 */
import { existsSync, rmSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const keepConfig = process.argv.includes("--keep-config");

function installDir() {
	return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "PixelOffice");
}

function removeIfExists(path) {
	if (!existsSync(path)) return;
	try {
		unlinkSync(path);
		console.log(`Removed ${path}`);
	} catch {
		console.warn(`Could not remove ${path}`);
	}
}

const desktop = join(homedir(), "Desktop");
const startMenu = join(
	process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
	"Microsoft",
	"Windows",
	"Start Menu",
	"Programs",
);

for (const dir of [desktop, startMenu]) {
	removeIfExists(join(dir, "PIXTiel.lnk"));
	removeIfExists(join(dir, "PIXTiel Stop.lnk"));
}

const base = installDir();
if (existsSync(base)) {
	if (keepConfig) {
		const app = join(base, "app");
		if (existsSync(app)) {
			rmSync(app, { recursive: true, force: true });
			console.log(`Removed ${app}`);
		}
		console.log("Kept config.json (--keep-config).");
	} else {
		rmSync(base, { recursive: true, force: true });
		console.log(`Removed ${base}`);
	}
}

console.log("Uninstall complete.");
