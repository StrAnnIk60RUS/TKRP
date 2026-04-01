import { runPlanSnapshotRetention } from '../../modules/planning/services/planSnapshotStore.js';

/**
 * Очистка/обрезка runtime-артефактов при старте API (снапшоты планов по лимиту PLAN_SNAPSHOT_MAX_FILES).
 */
export async function runRuntimeRetentionOnStartup() {
  try {
    const { removed } = await runPlanSnapshotRetention();
    if (removed > 0) {
      console.log(JSON.stringify({ event: 'runtime_retention', plan_snapshots_removed: removed }));
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'runtime_retention_failed',
        error: String(error?.message || error)
      })
    );
  }
}
