import readline from "node:readline";

/** items: [{id, label, checked, locked}] ; returns Set<id> or null on abort. */
export async function checkboxSelect(items, { out = process.stdout, in: input = process.stdin } = {}) {
	if (!input.isTTY) throw new Error("checkboxSelect requires a TTY; use --features id,id instead.");
	const state = items.map((it) => ({ ...it }));
	let cursor = 0, rendered = 0;

	const render = () => {
		if (rendered > 0) out.write(`\x1b[${rendered}A`);
		const lines = state.map((it, i) => {
			const box = it.checked ? "[x]" : "[ ]";
			const ptr = i === cursor ? "❯" : " ";
			const lock = it.locked ? " (required)" : "";
			return `\x1b[2K ${ptr} ${box} ${it.label}${lock}`;
		});
		lines.push("\x1b[2K   ↑/↓ move · space toggle · a all · enter confirm · q quit");
		out.write(lines.join("\n") + "\n");
		rendered = lines.length;
	};

	readline.emitKeypressEvents(input);
	input.setRawMode(true);
	out.write("\x1b[?25l"); // hide cursor
	try {
		render();
		return await new Promise((resolve) => {
			const onKey = (_str, key) => {
				if (!key) return;
				if (key.name === "up" || key.name === "k") cursor = (cursor + state.length - 1) % state.length;
				else if (key.name === "down" || key.name === "j") cursor = (cursor + 1) % state.length;
				else if (key.name === "space") { if (!state[cursor].locked) state[cursor].checked = !state[cursor].checked; }
				else if (key.name === "a") { const on = state.some((s) => !s.checked && !s.locked); state.forEach((s) => { if (!s.locked) s.checked = on; }); }
				else if (key.name === "return") { input.off("keypress", onKey); resolve(new Set(state.filter((s) => s.checked).map((s) => s.id))); return; }
				else if (key.name === "q" || (key.ctrl && key.name === "c")) { input.off("keypress", onKey); resolve(null); return; }
				render();
			};
			input.on("keypress", onKey);
		});
	} finally {
		input.setRawMode(false); // PXT-12: restore on EVERY path
		out.write("\x1b[?25h");
		input.pause();
	}
}

if (process.argv.includes("--demo")) {
	const sampleItems = [
		{ id: "core", label: "Core runtime", checked: true, locked: true },
		{ id: "desktop", label: "Desktop application", checked: true, locked: false },
		{ id: "vault", label: "Vault & Credentials", checked: false, locked: false },
		{ id: "docs", label: "Documentation site", checked: false, locked: false },
	];
	try {
		const selected = await checkboxSelect(sampleItems);
		if (selected === null) {
			process.exit(130);
		}
		console.log("Selected features:", Array.from(selected).join(", "));
	} catch (err) {
		console.error(err.message);
		process.exit(1);
	}
}
