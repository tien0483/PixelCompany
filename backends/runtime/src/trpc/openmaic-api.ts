import type { RuntimeOpenmaicStatus } from "../core/api-contract";
import {
	DEFAULT_OPENMAIC_HOST,
	findOpenmaicRoot,
	isOpenmaicBuilt,
	isOpenmaicBuiltForEmbedding,
	resolveOpenmaicBaseUrl,
	resolveOpenmaicPort,
} from "../openmaic/openmaic-endpoint";
import { probePort } from "../stack/stack-ports";
import type { RuntimeTrpcContext } from "./app-router";

/**
 * Availability for the Learning tab.
 *
 * There is no HTTP client the way Flowise has one: OpenMAIC exposes no version endpoint
 * worth depending on, and the only question the tab asks is "can I frame it". A TCP probe
 * answers that without pulling a Next.js page render on every 5 s poll.
 */
export function createOpenmaicApi(): RuntimeTrpcContext["openmaicApi"] {
	return {
		status: async (): Promise<RuntimeOpenmaicStatus> => {
			const root = findOpenmaicRoot();
			const baseUrl = resolveOpenmaicBaseUrl(undefined);
			const online = await probePort(DEFAULT_OPENMAIC_HOST, resolveOpenmaicPort(undefined));
			const built = root !== null && isOpenmaicBuilt(root);
			return {
				online,
				installed: root !== null,
				built,
				embeddable: built && root !== null && isOpenmaicBuiltForEmbedding(root),
				baseUrl,
			};
		},
	};
}
