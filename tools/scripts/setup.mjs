/**
 * One-shot local developer bootstrap: npm (root + api via postinstall), pip, .env from example.
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function run(label, cmd, args, opts = {}) {
  console.log(`\n→ ${label}`)
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    ...opts
  })
  if (result.status === null || result.status !== 0) {
    console.error(`\nFailed: ${label}`)
    process.exit(result.status === null ? 1 : result.status)
  }
}

function resolvePython() {
  const candidates = ['python', 'python3']
  for (const bin of candidates) {
    const check = spawnSync(bin, ['-m', 'pip', '--version'], {
      shell: true,
      encoding: 'utf8'
    })
    if (check.status === 0) return bin
  }
  console.error(
    'Python with pip not found. Install Python 3.11+ and ensure `python -m pip` works.'
  )
  process.exit(1)
}

const envExample = path.join(root, '.env.example')
const envPath = path.join(root, '.env')

console.log('TKRP setup (repo root: %s)', root)

run('npm install (root; postinstall installs apps/api)', 'npm', ['install'])

const py = resolvePython()
run('pip install -r requirements.txt', py, ['-m', 'pip', 'install', '-r', 'requirements.txt'])

if (!fs.existsSync(envPath)) {
  if (!fs.existsSync(envExample)) {
    console.warn('\nWarning: .env.example missing; skipping .env creation.')
  } else {
    fs.copyFileSync(envExample, envPath)
    console.log(
      '\n✓ Created .env from .env.example — set OPENROUTER_API_KEY (and optional cookies) before using LLM/parser features.'
    )
  }
} else {
  console.log('\n.env already exists; left unchanged.')
}

console.log('\nDone. Next: npm run dev')
