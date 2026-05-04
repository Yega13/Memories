import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const requestedDistDir = process.env.NEXT_DIST_DIR || '.next-dev-local'
process.env.NEXT_DIST_DIR = requestedDistDir

try {
  rmSync(requestedDistDir, { recursive: true, force: true })
} catch {
  process.env.NEXT_DIST_DIR = `.next-dev-local-${Date.now()}`
}

const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'dev'], {
  env: process.env,
  stdio: 'inherit',
  shell: false,
})

process.exit(result.status ?? 1)
