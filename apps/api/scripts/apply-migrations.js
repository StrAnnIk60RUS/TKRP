import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function resolveDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  try {
    const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
    const content = fs.readFileSync(envFile, 'utf-8');
    const match = content.match(/^DATABASE_URL=(.*)$/m);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    // ignore
  }
  throw new Error('DATABASE_URL не задан (env или .env в корне репозитория)');
}

async function main() {
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(), max: 1 });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(256) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('Миграции не найдены');
      return;
    }

    const applied = new Set(
      (await pool.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name)
    );

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  ${file} — уже применена`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      console.log(`▶ Применяю ${file}...`);
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      console.log(`✅ ${file}`);
    }

    console.log('Все миграции применены');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка применения миграций:', error.message || error);
  process.exit(1);
});
