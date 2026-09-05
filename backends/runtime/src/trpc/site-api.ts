// Status for the product website sidecar that the Docs tab frames. Deliberately thin:
// "is it built" is a file check and "is it up" is a port probe, so the 5 s poll behind the
// Docs tab never pulls a page render.
import type { RuntimeSiteStatus } from "../core/api-contract";
import {
	DEFAULT_SITE_HOST,
	findSiteDistDir,
	isHostedSiteUrl,
	resolveSiteBaseUrl,
	resolveSitePort,
	SITE_BUILD_COMMAND,
	SITE_DOCS_PATH,
} from "../site/site-endpoint";
import { probePort } from "../stack/stack-ports";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateSiteApiDependencies {
	/** Overrides for tests. */
	findDistDir?: () => string | null;
	probe?: (host: string, port: number) => Promise<boolean>;
	resolveBaseUrl?: () => string;
}

export function createSiteApi(deps: CreateSiteApiDependencies = {}): RuntimeTrpcContext["siteApi"] {
	const findDistDir = deps.findDistDir ?? findSiteDistDir;
	const probe = deps.probe ?? probePort;
	const resolveBaseUrl = deps.resolveBaseUrl ?? (() => resolveSiteBaseUrl());
	return {
		status: async (): Promise<RuntimeSiteStatus> => {
			const baseUrl = resolveBaseUrl();
			if (isHostedSiteUrl(baseUrl)) {
				return {
					built: true,
					online: true,
					baseUrl,
					docsPath: SITE_DOCS_PATH,
					buildCommand: SITE_BUILD_COMMAND,
				};
			}
			const distDir = findDistDir();
			const online = await probe(DEFAULT_SITE_HOST, resolveSitePort());
			return {
				built: distDir !== null,
				online,
				baseUrl,
				docsPath: SITE_DOCS_PATH,
				buildCommand: SITE_BUILD_COMMAND,
			};
		},
	};
}
