import * as dbRepo from './precedentRepositoryDb.js';

export const persistPrecedents = dbRepo.persistPrecedents;
export const getPrecedentsSummary = dbRepo.getPrecedentsSummary;
export const getPrecedentsSnapshot = dbRepo.getPrecedentsSnapshot;
export const searchPrecedents = dbRepo.searchPrecedents;
export const reembedPrecedentsWithWrongDimension = dbRepo.reembedPrecedentsWithWrongDimension;
export const getAggregatedOntology = dbRepo.getAggregatedOntology;
export const getOntologyExportData = dbRepo.getOntologyExportData;
export const getOntologyTurtleData = dbRepo.getOntologyTurtleData;

/**
 * Storage backend resolution (pure function for testability):
 * - PRECEDENT_STORAGE=pg is the only valid value (JSON storage removed).
 * - Back-compat: USE_DATABASE=true selects pg.
 * - Production default: APP_ENV=production forces pg.
 * - Dev default: pg.
 * @returns {'pg'}
 * @throws if PRECEDENT_STORAGE=json (JSON storage removed)
 */
export function resolveStorageBackend(env = process.env) {
  const explicit = String(env?.PRECEDENT_STORAGE || '').trim().toLowerCase();
  const appEnv = String(env?.APP_ENV || '').trim().toLowerCase();
  const production = appEnv === 'production';

  if (explicit === 'pg') return 'pg';
  if (explicit === 'json') {
    if (production) {
      throw new Error(
        'PRECEDENT_STORAGE=json is removed; JSON storage is no longer supported. ' +
        'Set PRECEDENT_STORAGE=pg, or remove the variable to use pg (PostgreSQL + pgvector).'
      );
    } else {
      throw new Error(
        'PRECEDENT_STORAGE=json is removed; JSON storage is no longer supported. ' +
        'Set PRECEDENT_STORAGE=pg, or remove the variable to use pg (PostgreSQL + pgvector).'
      );
    }
  }
  if (explicit) {
    throw new Error(`Unknown PRECEDENT_STORAGE value: ${explicit} (expected pg)`);
  }

  if (production) return 'pg';
  if (String(env?.USE_DATABASE || '').trim().toLowerCase() === 'true') return 'pg';
  return 'pg';
}

export function getActiveStorageBackend() {
  return resolveStorageBackend();
}