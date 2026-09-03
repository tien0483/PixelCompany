// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// `site` makes RSS items and social tags absolute. Override per deploy with
// PIXTIEL_SITE_URL; the default is the canonical product domain.
const site = process.env.PIXTIEL_SITE_URL ?? "https://pixtiel.dev";

export default defineConfig({
	site,
	integrations: [mdx()],
	vite: {
		plugins: [tailwindcss()],
	},
});
