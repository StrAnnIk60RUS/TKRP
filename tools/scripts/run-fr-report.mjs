/**
 * Прогон матрицы функциональных требований и текстовый отчёт для ПЗ.
 * npm run test:fr
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FR_REQUIREMENTS } from '../testing/fr-requirements.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'apps', 'api', 'test-results')
const reportPath = join(outDir, 'fr-matrix-report.txt')

const testFiles = [
  join(root, 'apps/web/tests/functional-requirements-registry.test.js'),
  join(root, 'apps/web/tests/functional-requirements-ui.test.js')
]

const nodeResult = spawnSync(
  process.execPath,
  ['--test', '--test-reporter=spec', ...testFiles],
  { cwd: root, encoding: 'utf8', env: process.env }
)

mkdirSync(outDir, { recursive: true })

const now = new Date()
const dateStr = now.toISOString().replace('T', ' ').slice(0, 19)
const nodeVer = spawnSync(process.execPath, ['-v'], { encoding: 'utf8' }).stdout.trim()
const npmVer = spawnSync('npm', ['-v'], { encoding: 'utf8', shell: true }).stdout.trim()

const pass = nodeResult.status === 0
const totalFr = FR_REQUIREMENTS.length
const colId = 14
const colBlock = 28
const colLayer = 8
const colTitle = 52

const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

const lines = [
  '================================================================================',
  '  ОТЧЁТ ФУНКЦИОНАЛЬНОГО ТЕСТИРОВАНИЯ — МАТРИЦА ТР (табл. 2.1, п. 5.1, UI-сценарии)',
  '================================================================================',
  `Дата прогона:     ${dateStr}`,
  `Среда:            ${process.platform}; Node.js ${nodeVer}; npm ${npmVer}`,
  `Команда:          npm run test:fr`,
  `Источник ТР:      tools/testing/fr-requirements.mjs`,
  '--------------------------------------------------------------------------------',
  `Всего требований: ${totalFr}`,
  `Пройдено:         ${pass ? totalFr : '—'}`,
  `Провалено:        ${pass ? 0 : '—'}`,
  `Итог:             ${pass ? 'PASS (все требования подтверждены)' : 'FAIL — см. вывод тестов ниже'}`,
  '================================================================================',
  '',
  `${pad('ID', colId)} | ${pad('Блок', colBlock)} | ${pad('Слой', colLayer)} | ${pad('Требование', colTitle)} | Результат`,
  `${'-'.repeat(colId)}-+-${'-'.repeat(colBlock)}-+-${'-'.repeat(colLayer)}-+-${'-'.repeat(colTitle)}-+-${'-'.repeat(10)}`
]

for (const req of FR_REQUIREMENTS) {
  lines.push(
    `${pad(req.id, colId)} | ${pad(req.block, colBlock)} | ${pad(req.layer, colLayer)} | ${pad(req.title, colTitle)} | ${pass ? 'PASS' : '—'}`
  )
}

lines.push('')
lines.push('--------------------------------------------------------------------------------')
lines.push('Слои проверки:')
lines.push('  API    — контракт HTTP-ответов (фикстуры + Postman tools/postman/)')
lines.push('  UI     — клиентские утилиты и сценарии мастера (apps/web/)')
lines.push('  module — серверные модули enrichment / RAG / plan (apps/api/)')
lines.push('')
lines.push('Дополнительно: Postman Collection Runner — папка «00 Матрица FR (сводка)»')
lines.push('================================================================================')
lines.push('')
lines.push('--- Вывод node --test (spec) ---')
lines.push('')
lines.push(nodeResult.stdout || '')
if (nodeResult.stderr) {
  lines.push('--- stderr ---')
  lines.push(nodeResult.stderr)
}

writeFileSync(reportPath, lines.join('\n'), 'utf8')

console.log(`\nОтчёт записан: ${reportPath}`)
console.log(`Итог матрицы FR: ${pass ? 'PASS' : 'FAIL'} (${totalFr} требований)\n`)

if (!pass) {
  process.exit(nodeResult.status ?? 1)
}
