import pg from 'pg';

let pool = null;

export function isDatabaseEnabled() {
  if (!process.env.DATABASE_URL) return false;
  const storage = String(process.env.PRECEDENT_STORAGE || '').trim().toLowerCase();
  if (storage === 'pg') return true;
  if (String(process.env.USE_DATABASE || '').trim().toLowerCase() === 'true') return true;
  return String(process.env.APP_ENV || '').trim().toLowerCase() === 'production';
}

export function getPool() {
  if (!isDatabaseEnabled()) {
    throw new Error('DATABASE_URL/USE_DATABASE не настроены');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000)
    });
    pool.on('error', (error) => {
      console.error('[db] Idle client error:', error?.message || error);
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
