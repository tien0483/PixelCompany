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
	/**
	 * Present when the template ships an `example.md`/`example.html` pair. `hasHtml`
	 * is what gates the thumbnail: the sidecar only serves
	 * `/api/templates/:id/preview` for templates that have one.
	 */
	example?: {
		hasHtml: boolean;
		hasMd: boolean;
	};
}

/**
 * `recommended` (1, 2, 3 …) is the registry's own ranking; templates without it keep
 * their directory order behind the ranked ones. The sidecar's picker honours this and
 * the plan editor used to ignore it, silently defaulting to whatever sorted first on disk.
 */
function byRecommendedRank(templates: HtmlTemplateMeta[]): HtmlTemplateMeta[] {
	return [...templates].sort((a, b) => {
		const rankA = a.recommended ?? Number.POSITIVE_INFINITY;
		const rankB = b.recommended ?? Number.POSITIVE_INFINITY;
		return rankA - rankB;
	});
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
					setTemplates(byRecommendedRank(list));
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
