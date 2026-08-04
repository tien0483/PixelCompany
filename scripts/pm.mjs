#!/usr/bin/env node
/**
 * Package-manager agnostic script runner.
 * Uses whichever client invoked the current lifecycle (npm or pnpm).
 *
 *   node scripts/pm.mjs run <script> [args...]
 *   node scripts/pm.mjs dir <package-dir> <script> [args...]
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const [mode, ...rest] = process.argv.slice(2)

function detectPm() {
  const ua = process.env.npm_config_user_agent || ''
  if (ua.includes('pnpm')) return 'pnpm'
  if (ua.includes('yarn')) return 'yarn'
  if (ua.includes('npm')) return 'npm'
  // Repo declares packageManager: pnpm@...
  return 'pnpm'
}

function run(cmd, args, cwd, { exit = true } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  const status = result.status ?? 1
  if (exit) process.exit(status)
  return status
}

function runWithExecpath(args, cwd) {
  const execPath = process.env.npm_execpath
  if (execPath) {
    run(process.execPath, [execPath, ...args], cwd)
    return
  }
  run(detectPm(), args, cwd)
}

if (mode === 'run') {
  const [script, ...extra] = rest
  if (!script) {
    console.error('Usage: node scripts/pm.mjs run <script> [args...]')
    process.exit(1)
  }
  runWithExecpath(['run', script, ...extra], process.cwd())
} else if (mode === 'dir') {
  const [pkgDir, script, ...extra] = rest
  if (!pkgDir || !script) {
    console.error('Usage: node scripts/pm.mjs dir <package-dir> <script> [args...]')
    process.exit(1)
  }
  const cwd = path.resolve(process.cwd(), pkgDir)
  const pm = detectPm()
  if (pm === 'pnpm') {
    run('pnpm', ['--dir', cwd, 'run', script, ...extra], repoRoot)
  } else {
    run('npm', ['--prefix', cwd, 'run', script, ...extra], repoRoot)
  }
} else if (mode === 'install-all') {
  const pm = detectPm()
  const desktopDir = path.join(repoRoot, 'backends/runtime/packages/desktop')
  let status
  if (pm === 'pnpm') {
    status = run('pnpm', ['install'], repoRoot, { exit: false })
    if (status === 0) status = run('pnpm', ['--dir', desktopDir, 'install'], repoRoot, { exit: false })
  } else {
    status = run('npm', ['install'], repoRoot, { exit: false })
    if (status === 0) {
      status = run('npm', ['--prefix', desktopDir, 'install'], repoRoot, { exit: false })
    }
  }
  process.exit(status ?? 1)
} else {
  console.error('Usage: node scripts/pm.mjs <run|dir|install-all> ...')
  process.exit(1)
}
