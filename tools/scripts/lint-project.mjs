import fs from 'fs'
import path from 'path'

const repoRoot = process.cwd()

const checks = [
  {
    file: 'tools/parser/main.py',
    forbidden: ['remixstlid=', 'bcookie="...";'],
    message: 'Parser must not contain hardcoded cookies.'
  },
  {
    file: 'apps/api/server.js',
    forbidden: ['app.use(cors());'],
    message: 'Server must use configured CORS allowlist.'
  }
]

let hasFailures = false

for (const check of checks) {
  const targetPath = path.join(repoRoot, check.file)
  if (!fs.existsSync(targetPath)) {
    console.error(`[lint-project] Missing required file: ${check.file}`)
    hasFailures = true
    continue
  }

  const content = fs.readFileSync(targetPath, 'utf-8')
  for (const forbiddenText of check.forbidden) {
    if (content.includes(forbiddenText)) {
      console.error(`[lint-project] ${check.message} Found forbidden text "${forbiddenText}" in ${check.file}`)
      hasFailures = true
    }
  }
}

if (hasFailures) {
  process.exit(1)
}

console.log('[lint-project] All repository checks passed.')
