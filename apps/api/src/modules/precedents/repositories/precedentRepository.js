import * as jsonRepo from './precedentRepositoryJson.js';
import * as dbRepo from './precedentRepositoryDb.js';

/**
 * Storage backend resolution (pure function for testability):
 * - PRECEDENT_STORAGE=json|pg is the explicit switch (wins over everything).
 * - Back-compat: USE_DATABASE=true selects pg.
 * - Production default: APP_ENV=production forces pg (JSON storage is dev-only);
 *   PRECEDENT_STORAGE=json in production is a hard error.
 * - Dev default: json.
 * @returns {'json'|'pg'}
 */
export function resolveStorageBackend(env = process.env) {
  const explicit = String(env?.PRECEDENT_STORAGE || '').trim().toLowerCase();
  const appEnv = String(env?.APP_ENV || '').trim().toLowerCase();
  const production = appEnv === 'production';

  if (explicit === 'pg') return 'pg';
  if (explicit === 'json') {
    if (production) {
      throw new Error(
        'PRECEDENT_STORAGE=json is dev-only; production must use pg (PostgreSQL + pgvector). ' +
        'Set DATABASE_URL and PRECEDENT_STORAGE=pg, or run with APP_ENV=development.'
      );
    }
    return 'json';
  }
  if (explicit) {
    throw new Error(`Unknown PRECEDENT_STORAGE value: ${explicit} (expected json|pg)`);
  }

  if (production) return 'pg';
  if (String(env?.USE_DATABASE || '').trim().toLowerCase() === 'true') return 'pg';
  return 'json';
}

const ACTIVE_BACKEND = resolveStorageBackend();
const repo = ACTIVE_BACKEND === 'pg' ? dbRepo : jsonRepo;

export const persistPrecedents = repo.persistPrecedents;
export const getPrecedentsSummary = repo.getPrecedentsSummary;
export const getPrecedentsSnapshot = repo.getPrecedentsSnapshot;
export const searchPrecedents = repo.searchPrecedents;
export const reembedPrecedentsWithWrongDimension = repo.reembedPrecedentsWithWrongDimension;
export const getAggregatedOntology = repo.getAggregatedOntology;
export const getOntologyExportData = repo.getOntologyExportData;
export const getOntologyTurtleData = repo.getOntologyTurtleData;

export function getActiveStorageBackend() {
  return ACTIVE_BACKEND;
}
