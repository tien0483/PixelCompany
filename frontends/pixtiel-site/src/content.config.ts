import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		order: z.number().default(99),
	}),
});

const blog = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		/** Publication date — drives ordering and the RSS feed. */
		date: z.coerce.date(),
		author: z.string().default("Tiến Nguyễn"),
		tags: z.array(z.string()).default([]),
		/** Drafts render locally but stay out of the index and the feed. */
		draft: z.boolean().default(false),
	}),
});

export const collections = { docs, blog };
