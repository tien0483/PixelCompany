import { useCallback, useEffect, useRef, useState } from "react";

import { useHtmlAgentStream } from "@/html/use-html-agent-stream";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface DocProjectMeta {
	id: string;
	name: string;
	targetRepo: string;
	workspaceDir: string;
	tagline: string;
	createdAt: string;
	hasSite: boolean;
	docCount: number;
	lastBuildAt: string | null;
}

export interface UseDocProjectsResult {
	online: boolean;
	projects: DocProjectMeta[];
	loading: boolean;
	refresh: () => Promise<void>;
}

export function useDocProjects(): UseDocProjectsResult {
	const [online, setOnline] = useState(false);
	const [projects, setProjects] = useState<DocProjectMeta[]>([]);
	const [loading, setLoading] = useState(true);
	// Guards state updates from a load() call whose component has since unmounted
	// (or a newer load() has superseded it); mirrors the cancelled-flag shape in
	// useHtmlTemplates, extracted here so both the mount effect and `refresh` share it.
	const cancelledRef = useRef(false);

	const load = useCallback(async () => {
		try {
			const client = getRuntimeTrpcClient(null);
			const status = await client.docSkill.status.query();
			if (cancelledRef.current) return;
			setOnline(status.online);
			if (!status.online) {
				setProjects([]);
				return;
			}
			const list = await client.docSkill.projects.query();
			if (!cancelledRef.current) setProjects(list);
		} catch {
			if (!cancelledRef.current) {
				setOnline(false);
				setProjects([]);
			}
		} finally {
			if (!cancelledRef.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		cancelledRef.current = false;
		void load();
		return () => {
			cancelledRef.current = true;
		};
	}, [load]);

	return { online, projects, loading, refresh: load };
}

export interface CreateDocProjectInput {
	name: string;
	targetRepo: string;
	workspaceDir: string;
	sources: string[];
	tagline?: string;
}

export interface UseCreateDocProjectResult {
	create: (input: CreateDocProjectInput) => Promise<DocProjectMeta>;
	loading: boolean;
	error: string | null;
}

export function useCreateDocProject(): UseCreateDocProjectResult {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const create = useCallback(async (input: CreateDocProjectInput) => {
		setLoading(true);
		setError(null);
		try {
			const client = getRuntimeTrpcClient(null);
			const project = await client.docSkill.createProject.mutate(input);
			return project;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			throw err;
		} finally {
			setLoading(false);
		}
	}, []);

	return { create, loading, error };
}

export interface DocAuditRequest {
	projectId: string;
	targetRepo: string;
	workspaceDir: string;
	focus?: string;
	model?: string;
	managerAccountId?: number;
}

export interface DocRoundRequest {
	projectId: string;
	targetRepo: string;
	workspaceDir: string;
	model?: string;
	managerAccountId?: number;
}

/** One-shot audit agent run over the target repo. */
export function useDocAudit() {
	return useHtmlAgentStream<DocAuditRequest>("/api/doc-skill/audit");
}

/** One-shot round-check agent run: verifies existing docs still match the repo. */
export function useDocRound() {
	return useHtmlAgentStream<DocRoundRequest>("/api/doc-skill/round");
}
