import { useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeReviewCommandsResponse } from "@/runtime/types";

export type ReviewProjectCommand = RuntimeReviewCommandsResponse["commands"][number];

/**
 * The selected checkout's own slash commands, for the chip row above the composer.
 *
 * Fetched per project path because that is exactly what decides the answer: the chat
 * agent runs with that path as cwd, so those are the commands Claude Code can expand.
 * A failure resolves to an empty list — the built-in chips and free-text prompts are
 * unaffected, and a missing `.claude/commands` is the normal case, not an error.
 */
export function useReviewProjectCommands(input: {
	projectPath: string | undefined;
	workspaceId: string | null;
}): ReviewProjectCommand[] {
	const { projectPath, workspaceId } = input;
	const [commands, setCommands] = useState<ReviewProjectCommand[]>([]);

	useEffect(() => {
		if (!projectPath) {
			setCommands([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const response = await client.review.listCommands.query({ projectPath });
				if (!cancelled) {
					setCommands(response.ok ? response.commands : []);
				}
			} catch {
				if (!cancelled) {
					setCommands([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectPath, workspaceId]);

	return commands;
}
