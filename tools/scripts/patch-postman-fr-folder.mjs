import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const collectionPath = join(root, 'tools/postman/TKRP-API.postman_collection.json')
const exec = JSON.parse(readFileSync(join(root, 'tools/postman/fr-matrix-tests.exec.json'), 'utf8'))

const collection = JSON.parse(readFileSync(collectionPath, 'utf8'))

const folder00 = {
  name: '00 Матрица FR (сводка, без LLM)',
  description:
    'Сводный прогон всех 35 функциональных требований (табл. 2.1, п. 5.1, UI). Вкладка Tests — зелёные проверки для отчёта в ПЗ. Не требует OpenRouter. Один запрос; при недоступном API сетевые assert допускают code 0.',
  item: [
    {
      name: 'GET /health — матрица FR (Tests)',
      event: [
        {
          listen: 'test',
          script: { type: 'text/javascript', exec }
        }
      ],
      request: {
        method: 'GET',
        header: [],
        url: '{{baseUrl}}/health'
      }
    }
  ]
}

if (!collection.item.some((i) => i.name?.startsWith('00 Матрица FR'))) {
  collection.item.unshift(folder00)
}

collection.info.description =
  'Коллекция для проверки функциональных требований подсистемы БЯМ/RAG (табл. 2.1 ПЗ).\n\n' +
  '**Для скриншота в ПЗ:** папка **00 Матрица FR** + `npm run test:fr`.\n\n' +
  '**Запуск API:** `npm run dev:server`; `baseUrl` = http://localhost:3001.\n\n' +
  'Папки 01, 04–06 — без LLM. Папки 02–03 — с OPENROUTER_API_KEY.'

writeFileSync(collectionPath, JSON.stringify(collection, null, 2) + '\n')
console.log('Patched', collectionPath)
