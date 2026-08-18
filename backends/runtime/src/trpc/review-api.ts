import type {
	RuntimeReviewRulesConfig,
	RuntimeReviewRulesConfigResponse,
	RuntimeReviewRulesReadRequest,
	RuntimeReviewRulesReadResponse,
	RuntimeReviewSession,
	RuntimeReviewSessionReadRequest,
	RuntimeReviewSessionResponse,
	RuntimeReviewSessionWriteRequest,
} from "../core/api-contract";
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
	};
}
