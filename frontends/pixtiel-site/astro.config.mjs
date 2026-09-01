// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// site / base: set when hosting is wired
export default defineConfig({
	integrations: [mdx()],
	vite: {
		plugins: [tailwindcss()],
	},
});
