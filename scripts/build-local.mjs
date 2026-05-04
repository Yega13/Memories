import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const requestedDistDir = process.env.NEXT_DIST_DIR || '.next-local'
process.env.NEXT_DIST_DIR = requestedDistDir

try {
  rmSync(requestedDistDir, { recursive: true, force: true })
} catch {
  process.env.NEXT_DIST_DIR = `.next-local-${Date.now()}`
}

const preservedFiles = ['tsconfig.json', 'next-env.d.ts']
const preserved = new Map(
  preservedFiles
    .filter((file) => existsSync(file))
    .map((file) => [file, readFileSync(file, 'utf8')]),
)

const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  env: process.env,
  stdio: 'inherit',
  shell: false,
})

for (const [file, contents] of preserved) {
  writeFileSync(file, contents, 'utf8')
}

process.exit(result.status ?? 1)
