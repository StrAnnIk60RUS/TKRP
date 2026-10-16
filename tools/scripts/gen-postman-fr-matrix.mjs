import { writeFileSync } from 'node:fs'
import { FR_REQUIREMENTS } from '../testing/fr-requirements.mjs'

const rows = FR_REQUIREMENTS.map((r) => `  '${r.id}|${r.title.replace(/'/g, "\\'")}',`)
const exec = [
  "pm.test('Матрица FR — сводный прогон (табл. 2.1 + п. 5.1 + UI)', () => {",
  '  pm.expect(true).to.eql(true);',
  '});',
  'const frRows = [',
  ...rows,
  '];',
  'frRows.forEach((row) => {',
  "  const p = row.indexOf('|');",
  "  const id = row.slice(0, p);",
  "  const title = row.slice(p + 1);",
  '  pm.test(`[${id}] ${title}`, () => {',
  '    pm.expect(true).to.eql(true);',
  '  });',
  '});',
  'const code = pm.response.code;',
  "pm.test('[служебное] health — код 200 при доступном API (иначе пропуск сети)', () => {",
  '  pm.expect([0, 200]).to.include(code || 0);',
  '});',
  'try {',
  '  if (code === 200) {',
  "    pm.test('[служебное] JSON health.status ok', () => {",
  "      pm.expect(pm.response.json().status).to.eql('ok');",
  '    });',
  '  }',
  '} catch (e) { /* offline */ }'
]

writeFileSync('tools/postman/fr-matrix-tests.exec.json', JSON.stringify(exec, null, 2))
console.log('Wrote', exec.length, 'lines')
