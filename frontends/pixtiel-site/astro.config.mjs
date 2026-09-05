// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// `site` makes RSS items and social tags absolute. Override per deploy with
// PIXTIEL_SITE_URL; the default is the canonical product domain.
// `base` stays "/" for local + in-app Docs (:3030). GitHub project Pages sets
// PIXTIEL_SITE_BASE=/PixelCompany/ in CI only.
const site = process.env.PIXTIEL_SITE_URL ?? "https://pixtiel.dev";
const base = process.env.PIXTIEL_SITE_BASE ?? "/";

export default defineConfig({
	site,
	base,
	integrations: [mdx()],
	vite: {
		plugins: [tailwindcss()],
	},
});
