import type {
	RuntimeReviewCheckProjectsGraphRequest,
	RuntimeReviewCheckProjectsGraphResponse,
	RuntimeReviewCommandsRequest,
	RuntimeReviewCommandsResponse,
	RuntimeReviewGraphDashboardRequest,
	RuntimeReviewGraphDashboardResponse,
	RuntimeReviewGraphImpactRequest,
	RuntimeReviewGraphImpactResponse,
	RuntimeReviewGraphRebuildActionRequest,
	RuntimeReviewGraphRebuildActionResponse,
	RuntimeReviewGraphRebuildStatusRequest,
	RuntimeReviewGraphRebuildStatusResponse,
	RuntimeReviewImportGraphRequest,
	RuntimeReviewImportGraphResponse,
	RuntimeReviewRulesConfig,
	RuntimeReviewRulesConfigResponse,
	RuntimeReviewRulesReadRequest,
	RuntimeReviewRulesReadResponse,
	RuntimeReviewSession,
	RuntimeReviewSessionReadRequest,
	RuntimeReviewSessionResponse,
	RuntimeReviewSessionWriteRequest,
} from "../core/api-contract";
import { listProjectSlashCommands } from "../review/review-commands";
import { startReviewGraphDashboard } from "../review/review-dashboard-process";
import { loadReviewGraphIndex, readReviewGraphFreshness } from "../review/review-graph";
import { buildReviewGraphBrief } from "../review/review-graph-brief";
import {
	checkProjectsGraphAvailability,
	copyUnderstandFolder,
	reviewGraphRebuildService,
} from "../review/review-graph-rebuild-service";
import { readReviewRulesBundle, readReviewRulesConfig, writeReviewRulesConfig } from "../review/review-rules";
import {
	createEmptyReviewSession,
	listReviewSessionsWithDrafts,
	readReviewSession,
	writeReviewSession,
} from "../state/review-sessions";
import type { RuntimeTrpcContext } from "./app-router";

export function createReviewApi(): RuntimeTrpcContext["reviewApi"] {
	const fail = (error: unknown): string => (error instanceof Error ? error.message : String(error));

	return {
		getSession: async (input: RuntimeReviewSessionReadRequest): Promise<RuntimeReviewSessionResponse> => {
			try {
				const existing = await readReviewSession(input.host, input.projectId, input.iid);
				// An absent session is not an error: the caller wants something to edit,
				// and returning an empty one saves every call site the same null branch.
				return { ok: true, session: existing ?? createEmptyReviewSession(input.host, input.projectId, input.iid) };
			} catch (error) {
				return { ok: false, session: null, error: fail(error) };
			}
		},

		saveSession: async (input: RuntimeReviewSessionWriteRequest): Promise<RuntimeReviewSessionResponse> => {
			try {
				return { ok: true, session: await writeReviewSession(input.session) };
			} catch (error) {
				return { ok: false, session: null, error: fail(error) };
			}
		},

		listSessionsWithDrafts: async (input: { host: string }): Promise<RuntimeReviewSession[]> => {
			try {
				return await listReviewSessionsWithDrafts(input.host);
			} catch {
				// The sidebar's unfinished-work list is a convenience; a read failure
				// there must not block opening a review.
				return [];
			}
		},

		getRules: async (input: RuntimeReviewRulesReadRequest): Promise<RuntimeReviewRulesReadResponse> => {
			try {
				return { ok: true, bundle: await readReviewRulesBundle(input.projectKey) };
			} catch (error) {
				return { ok: false, bundle: null, error: fail(error) };
			}
		},

		getRulesConfig: async (input: RuntimeReviewRulesReadRequest): Promise<RuntimeReviewRulesConfigResponse> => {
			try {
				return { ok: true, config: await readReviewRulesConfig(input.projectKey) };
			} catch (error) {
				return { ok: false, config: null, error: fail(error) };
			}
		},

		setRulesConfig: async (input: RuntimeReviewRulesConfig): Promise<RuntimeReviewRulesConfigResponse> => {
			try {
				await writeReviewRulesConfig(input);
				return { ok: true, config: input };
			} catch (error) {
				return { ok: false, config: null, error: fail(error) };
			}
		},

		listCommands: async (input: RuntimeReviewCommandsRequest): Promise<RuntimeReviewCommandsResponse> => {
			try {
				const listed = await listProjectSlashCommands({ projectPath: input.projectPath });
				return { ok: true, commands: listed.commands, omitted: listed.omitted };
			} catch (error) {
				return { ok: false, commands: [], omitted: 0, error: fail(error) };
			}
		},

		getGraphImpact: async (input: RuntimeReviewGraphImpactRequest): Promise<RuntimeReviewGraphImpactResponse> => {
			try {
				// Asked separately from the brief because the two disagree on what an
				// empty result means. The brief returns nothing when there is nothing
				// worth sending an agent; the panel still has to say *why* — no graph,
				// versus a graph that has never heard of these paths.
				const loaded = await loadReviewGraphIndex(input.projectPath);
				if (loaded.index === null) {
					return {
						ok: loaded.error === undefined,
						hasGraph: false,
						...(loaded.error === undefined ? {} : { error: loaded.error }),
					};
				}
				const index = loaded.index;
				if (input.changedPaths.length === 0) {
					// A graph with nothing to compare it against: report the graph itself so
					// the panel can still show what it would be reading.
					const freshness = await readReviewGraphFreshness(input.projectPath, index.project, {
						dataDir: index.dataDir,
					});
					return {
						ok: true,
						hasGraph: true,
						dataDir: index.dataDir,
						project: index.project,
						nodeCount: index.nodeCount,
						edgeCount: index.edgeCount,
						freshness,
						changed: [],
						affected: [],
						affectedOmitted: 0,
						dependencies: [],
						dependenciesOmitted: 0,
						layers: [],
						unmatchedPaths: [],
					};
				}
				const brief = await buildReviewGraphBrief({
					projectPath: input.projectPath,
					changedPaths: input.changedPaths,
					...(input.baseBranch === undefined ? {} : { baseBranch: input.baseBranch }),
				});
				if (brief === null) {
					return { ok: false, hasGraph: true, error: "The knowledge graph could not be read." };
				}
				return {
					ok: true,
					hasGraph: true,
					dataDir: brief.impact.dataDir,
					project: brief.impact.project,
					nodeCount: index.nodeCount,
					edgeCount: index.edgeCount,
					freshness: brief.freshness,
					changed: brief.impact.changed,
					affected: brief.impact.affected,
					affectedOmitted: brief.impact.affectedOmitted,
					dependencies: brief.impact.dependencies,
					dependenciesOmitted: brief.impact.dependenciesOmitted,
					layers: brief.impact.layers,
					unmatchedPaths: brief.impact.unmatchedPaths,
				};
			} catch (error) {
				return { ok: false, hasGraph: false, error: fail(error) };
			}
		},

		openGraphDashboard: async (
			input: RuntimeReviewGraphDashboardRequest,
		): Promise<RuntimeReviewGraphDashboardResponse> => {
			try {
				// No `warn`/`log` callbacks: nothing else in this layer writes to the
				// console, and a failure here has somewhere better to go — the error
				// travels back in the response and is rendered in the Impact panel, where
				// the person who pressed the button will actually read it.
				const started = await startReviewGraphDashboard({ projectPath: input.projectPath });
				if (!started.ok) {
					return { ok: false, error: started.error };
				}
				return { ok: true, url: started.dashboard.url, port: started.dashboard.port };
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		importGraph: async (
			input: RuntimeReviewImportGraphRequest,
		): Promise<RuntimeReviewImportGraphResponse> => {
			try {
				return await copyUnderstandFolder(input);
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		getRebuildStatus: async (
			input: RuntimeReviewGraphRebuildStatusRequest,
		): Promise<RuntimeReviewGraphRebuildStatusResponse> => {
			try {
				return reviewGraphRebuildService.getJobStatus(input.projectPath);
			} catch (error) {
				return {
					ok: false,
					status: "error",
					startedAt: null,
					doneAt: null,
					error: fail(error),
					currentStep: null,
					text: "",
					log: [],
					notices: [],
				};
			}
		},

		pauseRebuild: async (
			input: RuntimeReviewGraphRebuildActionRequest,
		): Promise<RuntimeReviewGraphRebuildActionResponse> => {
			try {
				const result = reviewGraphRebuildService.pauseJob(input.projectPath);
				return { ok: result.ok, status: "paused", ...(result.error ? { error: result.error } : {}) };
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		resumeRebuild: async (
			input: RuntimeReviewGraphRebuildActionRequest,
		): Promise<RuntimeReviewGraphRebuildActionResponse> => {
			try {
				const result = reviewGraphRebuildService.resumeJob(input.projectPath);
				return { ok: result.ok, status: "running", ...(result.error ? { error: result.error } : {}) };
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		cancelRebuild: async (
			input: RuntimeReviewGraphRebuildActionRequest,
		): Promise<RuntimeReviewGraphRebuildActionResponse> => {
			try {
				const result = reviewGraphRebuildService.cancelJob(input.projectPath);
				return { ok: result.ok, status: "error", ...(result.error ? { error: result.error } : {}) };
			} catch (error) {
				return { ok: false, error: fail(error) };
			}
		},

		checkProjectsGraph: async (
			input: RuntimeReviewCheckProjectsGraphRequest,
		): Promise<RuntimeReviewCheckProjectsGraphResponse> => {
			try {
				const available = await checkProjectsGraphAvailability(input.projectPaths);
				return { available };
			} catch {
				return { available: {} };
			}
		},
	};
}
