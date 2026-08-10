import { createClaudeUsageReader } from "../claude/claude-usage";
import type { RuntimeClaudeUsage } from "../core/api-contract";
import type { RuntimeTrpcContext } from "./app-router";

/**
 * One reader per process: the TTL cache and single-flight guard inside it only work
 * if every request shares the same instance, and tRPC builds a fresh context per call.
 */
const sharedReader = createClaudeUsageReader();

export function createClaudeUsageApi(): RuntimeTrpcContext["claudeUsageApi"] {
	return {
		get: async (): Promise<RuntimeClaudeUsage> => await sharedReader.get(),
	};
}
