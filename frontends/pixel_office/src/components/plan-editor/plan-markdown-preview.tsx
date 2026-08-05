import type { ReactElement } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { markdownComponents } from "@/components/detail-panels/cline-markdown-content";
import { cn } from "@/components/ui/cn";

const planMarkdownSanitizeSchema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
	attributes: {
		...defaultSchema.attributes,
		span: [...(defaultSchema.attributes?.span ?? []), "style"],
		img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title", "width", "height"],
	},
};

function isRelativeAssetPath(src: string): boolean {
	return !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
}

export function resolvePlanAssetUrl(planId: string | null, src: string | undefined): string | undefined {
	if (!src || !planId || !isRelativeAssetPath(src)) {
		return src;
	}
	return `/api/plans/asset?planId=${encodeURIComponent(planId)}&path=${encodeURIComponent(src)}`;
}

function createPlanMarkdownComponents(planId: string | null): Components {
	return {
		...markdownComponents,
		mark: ({ className, ...props }) => (
			<mark className={cn("rounded-sm bg-status-gold/30 px-0.5 text-text-primary", className)} {...props} />
		),
		img: ({ className, src, alt, ...props }) => (
			// biome-ignore lint/a11y/useAltText: alt text is author-controlled markdown content, not decorative
			<img
				src={resolvePlanAssetUrl(planId, typeof src === "string" ? src : undefined)}
				alt={alt ?? ""}
				className={cn("max-w-full rounded-md border border-border", className)}
				{...props}
			/>
		),
	};
}

export function PlanMarkdownPreview({ content, planId }: { content: string; planId: string | null }): ReactElement {
	if (!content.trim()) {
		return <span className="text-text-secondary" />;
	}
	return (
		<div className="kb-markdown min-w-0">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeRaw, [rehypeSanitize, planMarkdownSanitizeSchema]]}
				components={createPlanMarkdownComponents(planId)}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
