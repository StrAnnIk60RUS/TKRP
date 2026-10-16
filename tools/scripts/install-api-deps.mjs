/**
 * Installs npm dependencies for apps/api from the repo root.
 * Invoked from root postinstall. Set SKIP_POSTINSTALL=1 to skip (e.g. rare CI cases).
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

if (process.env.SKIP_POSTINSTALL === '1') {
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const result = spawnSync('npm', ['install', '--prefix', 'apps/api'], {
  cwd: root,
  stdio: 'inherit',
  shell: true
})
process.exit(result.status === null ? 1 : result.status)
