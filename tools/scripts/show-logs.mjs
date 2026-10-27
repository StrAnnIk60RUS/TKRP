#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const ERROR_LOG_PATH = path.join(ROOT, 'data', 'runtime', 'logs', 'error.log');

const limit = Number(process.argv[2]) || 20;

if (!fs.existsSync(ERROR_LOG_PATH)) {
  console.log('Лог-файл ошибок пуст или еще не создан (data/runtime/logs/error.log).');
  process.exit(0);
}

try {
  const content = fs.readFileSync(ERROR_LOG_PATH, 'utf8').trim();
  if (!content) {
    console.log('В error.log пока нет записей об ошибках.');
    process.exit(0);
  }

  const lines = content.split('\n').filter(Boolean);
  const tail = lines.slice(-limit);

  console.log(`\n=== Последние ${tail.length} записей об ошибках (data/runtime/logs/error.log) ===\n`);
  for (const line of tail) {
    try {
      const obj = JSON.parse(line);
      const time = obj.timestamp ? obj.timestamp.replace('T', ' ').slice(0, 19) : '';
      const level = obj.level || 'ERROR';
      const mod = obj.module ? `[${obj.module}] ` : '';
      const trace = obj.trace_id ? `(trace:${obj.trace_id}) ` : '';
      console.log(`${time} | ${level.padEnd(5)} | ${mod}${trace}${obj.message}`);
      if (obj.error?.stack) {
        console.log(`   Stack: ${obj.error.stack.split('\n')[0]}`);
      }
      if (obj.breadcrumbs?.length) {
        console.log(`   Breadcrumbs (${obj.breadcrumbs.length}):`);
        for (const b of obj.breadcrumbs.slice(-3)) {
          console.log(`     - [${b.category}] ${b.message}`);
        }
      }
    } catch {
      console.log(line);
    }
  }
} catch (err) {
  console.error('Ошибка чтения логов:', err.message);
}
