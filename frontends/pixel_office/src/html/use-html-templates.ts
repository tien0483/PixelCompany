import { useEffect, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

export interface HtmlTemplateMeta {
	id: string;
	zhName: string;
	enName: string;
	emoji: string;
	description: string;
	category: string;
	scenario: string;
	aspectHint: string;
	featured?: number;
	recommended?: number;
	tags: string[];
}

export interface UseHtmlTemplatesResult {
	online: boolean;
	templates: HtmlTemplateMeta[];
	loading: boolean;
}

export function useHtmlTemplates(): UseHtmlTemplatesResult {
	const [online, setOnline] = useState(false);
	const [templates, setTemplates] = useState<HtmlTemplateMeta[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const client = getRuntimeTrpcClient(null);
				const status = await client.html.status.query();
				if (cancelled) return;
				setOnline(status.online);
				if (!status.online) {
					setTemplates([]);
					return;
				}
				const list = await client.html.templates.query();
				if (!cancelled) {
					setTemplates(list);
				}
			} catch {
				if (!cancelled) {
					setOnline(false);
					setTemplates([]);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	return { online, templates, loading };
}
