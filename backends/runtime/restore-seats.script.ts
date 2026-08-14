/**
 * Throwaway restore of the API seats wiped when ~/.cline/data was deleted on 2026-08-14.
 * Writes through the runtime's own provider service (the same path the Seats UI uses), so
 * models.json and the SDK provider settings get their exact shapes. Delete after running.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createClineProviderService } from "./src/cline-sdk/cline-provider-service";

const CCR_SEAT_CONFIG = join(
	homedir(),
	"work/PixelCompany/backends/agent_stack/ccr-home/seats/fpt-ai/config-router.json",
);

async function readRecoveredFptKey(): Promise<string> {
	const raw = JSON.parse(await readFile(CCR_SEAT_CONFIG, "utf8")) as {
		routing?: { providers?: Record<string, { authentication?: { credentials?: { apiKey?: string } } }> };
	};
	const key = raw.routing?.providers?.["fpt-ai"]?.authentication?.credentials?.apiKey?.trim();
	if (!key) {
		throw new Error(`No fpt-ai apiKey in ${CCR_SEAT_CONFIG}`);
	}
	return key;
}

async function main(): Promise<void> {
	const service = createClineProviderService();
	const before = await service.listApiSeats();
	console.log(
		"seats before:",
		before.seats.map((seat) => seat.providerId),
	);

	const apiKey = await readRecoveredFptKey();
	console.log(`recovered fpt-ai key: ${apiKey.length} chars`);

	// Chat-capable subset of GET /v1/models; embeddings, rerankers and speech models are
	// not usable as an agent seat model.
	const fptChatModels = [
		"DeepSeek-V4-Flash",
		"GLM-5.2",
		"Llama-3.3-70B-Instruct",
		"Qwen2.5-VL-7B-Instruct",
		"Qwen3.6-27B",
		"gemma-3-27b-it",
		"gemma-4-26B-A4B-it",
		"gemma-4-31B-it",
		"gpt-oss-120b",
		"gpt-oss-20b",
	];

	const alreadyPresent = before.seats.some((seat) => seat.providerId === "fpt-ai");
	try {
		if (alreadyPresent) {
			await service.updateCustomProvider({
				providerId: "fpt-ai",
				name: "FPT.AI",
				baseUrl: "https://mkp-api.fptcloud.com/v1",
				apiKey,
				models: fptChatModels,
				defaultModelId: "DeepSeek-V4-Flash",
				modelsSourceUrl: "https://mkp-api.fptcloud.com/v1/models",
			});
			console.log("updated seat fpt-ai");
		} else {
			await service.addCustomProvider({
				providerId: "fpt-ai",
				name: "FPT.AI",
				baseUrl: "https://mkp-api.fptcloud.com/v1",
				apiKey,
				models: fptChatModels,
				defaultModelId: "DeepSeek-V4-Flash",
				modelsSourceUrl: "https://mkp-api.fptcloud.com/v1/models",
			});
			console.log("added seat fpt-ai");
		}
	} catch (error) {
		console.log("fpt-ai write failed:", error instanceof Error ? error.message : String(error));
	}

	// OmniRoute seat: its own api_keys table stores the caller key in plaintext, so the
	// wiped seat can be rebuilt without minting a new key. Never printed, only its length.
	try {
		const { DatabaseSync } = await import("node:sqlite");
		const db = new DatabaseSync(join(homedir(), ".omniroute/storage.sqlite"), { readOnly: true });
		const rows = db
			.prepare("SELECT name, key, created_at FROM api_keys ORDER BY created_at DESC")
			.all() as unknown as { name: string; key: string; created_at: string }[];
		db.close();
		console.log(
			"omniroute api_keys:",
			rows.map((row) => ({ name: row.name, createdAt: row.created_at, keyLength: row.key.length })),
		);
		const chosen = rows[0];
		if (!chosen) {
			console.log("omniroute: no api_keys row; seat left unrestored");
		} else {
			const omniroutePresent = before.seats.some((seat) => seat.providerId === "omniroute");
			const payload = {
				providerId: "omniroute",
				name: "OmniRoute",
				baseUrl: "http://127.0.0.1:8400/v1",
				apiKey: chosen.key,
				models: ["auto/best-coding"],
				defaultModelId: "auto/best-coding",
			};
			if (omniroutePresent) {
				await service.updateCustomProvider(payload);
				console.log(`updated seat omniroute using key "${chosen.name}"`);
			} else {
				await service.addCustomProvider(payload);
				console.log(`added seat omniroute using key "${chosen.name}"`);
			}
		}
	} catch (error) {
		console.log("omniroute write failed:", error instanceof Error ? error.message : String(error));
	}

	const after = await service.listApiSeats();
	console.log(
		"seats after:",
		after.seats.map((seat) => ({
			providerId: seat.providerId,
			baseUrl: seat.baseUrl,
			defaultModelId: seat.defaultModelId,
			models: seat.models,
			source: seat.source,
			apiKeyConfigured: seat.apiKeyConfigured,
		})),
	);
	process.exit(0);
}

await main();
