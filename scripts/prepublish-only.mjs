#!/usr/bin/env node
/**
 * Gate for backends/runtime prepublishOnly.
 *
 * pnpm packs `file:` / publishable workspace deps during install and runs
 * prepublishOnly — that must not force a full UI build+check on every install.
 * Real `pnpm publish` / `npm publish` still run build + check.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runtimeDir = path.resolve(__dirname, '../backends/runtime')

const command = process.env.npm_command || ''
const lifecycle = process.env.npm_lifecycle_event || ''
const argv = process.env.npm_config_argv || ''
const isPublish =
	command === 'publish' ||
	/\bpublish\b/.test(argv) ||
	process.env.PIXEL_FORCE_PREPUBLISH === '1'

if (!isPublish) {
	console.log(
		`[prepublishOnly] skip build/check (lifecycle=${lifecycle || 'unknown'}, not a publish)`,
	)
	process.exit(0)
}

const pm = path.resolve(__dirname, 'pm.mjs')
const build = spawnSync(process.execPath, [pm, 'run', 'build'], {
	cwd: runtimeDir,
	stdio: 'inherit',
	env: process.env,
})
if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1)

const check = spawnSync(process.execPath, [pm, 'run', 'check'], {
	cwd: runtimeDir,
	stdio: 'inherit',
	env: process.env,
})
process.exit(check.status ?? 1)
