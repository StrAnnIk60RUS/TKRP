import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PRECEDENTS = path.resolve(__dirname, '..', '..', '..', 'data', 'precedents');
const DATA_RUNTIME_API = path.resolve(__dirname, '..', '..', '..', 'data', 'runtime', 'api');

const USERS_TABLE = 'users';
const SESSIONS_TABLE = 'sessions';
const WIZARD_DRAFTS_TABLE = 'wizard_drafts';
const PLAN_SNAPSHOTS_TABLE = 'plan_snapshots';

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

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[migrate-runtime-to-db] File does not exist: ${filePath}`);
    return fallback;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    console.log(`[migrate-runtime-to-db] Successfully read ${filePath}, type: ${Array.isArray(parsed) ? 'array length ' + parsed.length : 'object keys ' + Object.keys(parsed).length}`);
    return parsed;
  } catch (error) {
    console.warn('[migrate-runtime-to-db] Failed to read JSON:', filePath, error?.message || error);
    return fallback;
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(), max: 1 });
  let jsonIdToDbId = new Map(); // map from JSON user UUID id to DB numeric id
  try {
    console.log('=== Migrating runtime JSON to DB (users, drafts, snapshots) ===');
    console.log(`__dirname: ${__dirname}`);
    console.log(`DATA_PRECEDENTS: ${DATA_PRECEDENTS}`);
    console.log(`DATA_RUNTIME_API: ${DATA_RUNTIME_API}`);

    // 1. Users
    const usersJsonPath = path.join(DATA_RUNTIME_API, 'users.json');
    console.log(`Looking for users at: ${usersJsonPath}`);
    const usersJson = readJson(usersJsonPath, []);
    console.log(`Users JSON: ${usersJson.length} records`);
    if (usersJson.length > 0) {
      // Build set of usernames from JSON
      const jsonUsernames = [...new Set(usersJson.map(u => u.username).filter(Boolean))];
      console.log(`Unique usernames in JSON: ${jsonUsernames.length}`);

      // Insert missing users
      const insertedUsers = [];
      for (const user of usersJson) {
        const { username, password_hash, created_at, id: jsonId } = user;
        if (!username || !password_hash) continue;
        const res = await pool.query(
          `INSERT INTO ${USERS_TABLE} (username, password_hash, created_at) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (username) DO NOTHING 
           RETURNING id, username`,
          [username, password_hash, created_at]
        );
        if (res.rowCount > 0) {
          insertedUsers.push({ jsonId, dbId: res.rows[0].id, username });
        }
      }
      console.log(`Inserted ${insertedUsers.length} new users`);

      // Build map from JSON user id (UUID) to DB user id for all JSON usernames
      const usernamesList = jsonUsernames.map(u => `'${u.replace(/'/g, "''")}'`).join(', ');
      const mapRes = await pool.query(
        `SELECT id, username FROM ${USERS_TABLE} WHERE username IN (${usernamesList})`
      );
      const usernameToDbId = new Map();
      for (const row of mapRes.rows) {
        usernameToDbId.set(row.username, row.id);
      }
      // Populate jsonIdToDbId for inserted users
      for (const { jsonId, dbId } of insertedUsers) {
        jsonIdToDbId.set(jsonId, dbId);
      }
      // Also map for existing users (those not inserted but present in JSON)
      for (const user of usersJson) {
        if (!jsonIdToDbId.has(user.id)) {
          const dbId = usernameToDbId.get(user.username);
          if (dbId !== undefined) {
            jsonIdToDbId.set(user.id, dbId);
          }
        }
      }
      console.log(`Built user id map for ${jsonIdToDbId.size} JSON user ids`);
    } else {
      console.log('No users in JSON');
    }

    // 2. Sessions: SKIPPED per user choice
    console.log('Skipping sessions migration (old tokens will require re-login)');

    // 3. Wizard drafts
    const wizardDraftPath = path.join(DATA_RUNTIME_API, 'wizard-draft.json');
    const draftsDir = path.join(DATA_RUNTIME_API, 'drafts');
    const wizardDraftJson = readJson(wizardDraftPath, null);
    const draftFiles = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).filter(f => f.endsWith('.json')) : [];

    console.log(`Wizard draft files: ${draftFiles.length} + wizard-draft.json: ${wizardDraftJson ? 1 : 0}`);

    if (wizardDraftJson || draftFiles.length > 0) {
      // We'll process each draft key
      const draftEntries = []; // each: { key, draftObj, updatedAt }
      if (wizardDraftJson && wizardDraftJson.draft !== undefined) {
        draftEntries.push({
          key: 'global',
          draft: wizardDraftJson.draft,
          updatedAt: wizardDraftJson.updated_at
        });
      }
      for (const fileName of draftFiles) {
        const filePath = path.join(draftsDir, fileName);
        const jsonObj = readJson(filePath, null);
        if (jsonObj && jsonObj.draft !== undefined) {
          const userIdUuid = fileName.slice(0, -5); // remove .json
          draftEntries.push({
            key: userIdUuid,
            draft: jsonObj.draft,
            updatedAt: jsonObj.updated_at
          });
        }
      }

      console.log(`Total draft entries to process: ${draftEntries.length}`);

      // Process each draft entry
      let processed = 0;
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (const entry of draftEntries) {
        let dbUserId = null;
        if (entry.key === 'global') {
          dbUserId = entry.key; // draft_key is 'global'
        } else {
          // entry.key is UUID user_id from JSON
          const dbId = jsonIdToDbId.get(entry.key);
          if (dbId === undefined) {
            console.warn(`Cannot find DB user ID for JSON user UUID ${entry.key}; skipping draft`);
            skipped++;
            continue;
          }
          dbUserId = dbId;
        }

        // Check existing row
        const existing = await pool.query(
          `SELECT draft, updated_at FROM ${WIZARD_DRAFTS_TABLE} WHERE draft_key = $1`,
          [dbUserId]
        );
        let shouldWrite = false;
        if (existing.rowCount === 0) {
          shouldWrite = true;
        } else {
          const dbUpdatedAt = new Date(existing.rows[0].updated_at);
          const jsonUpdatedAt = new Date(entry.updatedAt);
          if (jsonUpdatedAt > dbUpdatedAt) {
            shouldWrite = true;
          }
        }

        if (shouldWrite) {
          await pool.query(
            `INSERT INTO ${WIZARD_DRAFTS_TABLE} (draft_key, draft, updated_at) 
             VALUES ($1, $2, NOW()) 
             ON CONFLICT (draft_key) DO UPDATE SET 
               draft = EXCLUDED.draft, 
               updated_at = EXCLUDED.updated_at`,
            [dbUserId, JSON.stringify(entry.draft)]
          );
          if (existing.rowCount === 0) inserted++;
          else updated++;
        } else {
          skipped++;
        }
        processed++;
      }
      console.log(`Drafts processed: ${processed}, inserted: ${inserted}, updated: ${updated}, skipped (no change or missing user): ${skipped}`);
    } else {
      console.log('No wizard draft files found');
    }

    // 4. Plan snapshots
    const snapshotsDir = path.join(DATA_RUNTIME_API, 'plan-snapshots');
    const snapshotFiles = fs.existsSync(snapshotsDir) ? fs.readdirSync(snapshotsDir).filter(f => f.endsWith('.json')) : [];
    console.log(`Snapshot files: ${snapshotFiles.length}`);

    if (snapshotFiles.length > 0) {
      for (const fileName of snapshotFiles) {
        const filePath = path.join(snapshotsDir, fileName);
        const jsonObj = readJson(filePath, null);
        if (!jsonObj) continue;
        const { token, owner, saved_at, snapshot, summary } = jsonObj;
        if (!token) continue;
        // Upsert
        await pool.query(
          `INSERT INTO ${PLAN_SNAPSHOTS_TABLE} (token, owner, saved_at, snapshot, summary) 
           VALUES ($1, $2, $3, $4, $5) 
           ON CONFLICT (token) DO UPDATE SET 
             owner = EXCLUDED.owner, 
             saved_at = EXCLUDED.saved_at, 
             snapshot = EXCLUDED.snapshot, 
             summary = EXCLUDED.summary`,
          [token, owner, saved_at, JSON.stringify(snapshot), JSON.stringify(summary)]
        );
      }
      // Get counts after
      const afterCount = await pool.query(`SELECT COUNT(1) FROM ${PLAN_SNAPSHOTS_TABLE}`);
      console.log(`Plan snapshots after migration: ${afterCount.rows[0].count} rows`);
    } else {
      console.log('No snapshot files found');
    }

    // Final counts
    console.log('=== Final counts in DB ===');
    const tables = [USERS_TABLE, SESSIONS_TABLE, WIZARD_DRAFTS_TABLE, PLAN_SNAPSHOTS_TABLE, 'publications', 'content_plans', 'ingestion_runs', 'precedents_metadata'];
    for (const table of tables) {
      const res = await pool.query(`SELECT COUNT(1) FROM ${table}`);
      console.log(`${table}: ${res.rows[0].count}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});