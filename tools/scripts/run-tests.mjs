/**
 * Единая точка запуска node --test для корня монорепозитория.
 * Использование: node tools/scripts/run-tests.mjs [spec|junit]
 * Без аргумента — стандартный вывод (TAP).
 *
 * Переменные окружения (опционально):
 * - NODE_TEST_CONCURRENCY — параллельных файлов тестов (по умолчанию 1; выше — быстрее, но больше RAM).
 * - NODE_TEST_MAX_OLD_SPACE_SIZE_MB — лимит кучи V8 в МБ (по умолчанию 4096).
 */
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const testFiles = [
  'apps/web/tests/frontend-formUtils.test.js',
  'apps/web/tests/keyDatesModel.test.js',
  'apps/web/tests/publicationPresentation.test.js',
  'apps/web/tests/breadcrumbs.test.js',
  'apps/web/tests/clientReporter.test.js',
  'apps/web/tests/diagnosticsPresentation.test.js',
  'apps/web/tests/contentPlanExport.test.js',
  'apps/web/tests/functional-requirements-ui.test.js',
  'apps/web/tests/functional-requirements-registry.test.js',
  'apps/api/tests/ontologyAggregation.test.js',
  'apps/api/tests/security.test.js',
  'apps/api/tests/securityMore.test.js',
  'apps/api/tests/securityAuth.test.js',
  'apps/api/tests/planRoutes.integration.test.js',
  'apps/api/tests/routeUtils.test.js',
  'apps/api/tests/expressHttp.integration.test.js',
  'apps/api/tests/expressHttp.test.js',
  'apps/api/tests/contentModels.test.js',
  'apps/api/tests/gaCore.test.js',
  'apps/api/tests/operators.test.js',
  'apps/api/tests/planEvolution.test.js',
  'apps/api/tests/planUtils.test.js',
  'apps/api/tests/llmCache.test.js',
  'apps/api/tests/pipelineErrorHandler.test.js',
  'apps/api/tests/jsonSchemaValidator.test.js',
  'apps/api/tests/planDiversityLlmPass.test.js',
  'apps/api/tests/llmJsonParsing.test.js',
  'apps/api/tests/asyncGaCore.test.js',
  'apps/api/tests/fitnessUtils.test.js',
  'apps/api/tests/paretoUtils.test.js',
  'apps/api/tests/hierarchicalGa.test.js',
  'apps/api/tests/postEvolution.test.js',
  'apps/api/tests/mediaGenerationService.test.js',
  'apps/api/tests/engagementMetrics.test.js',
  'apps/api/tests/draftPlanGenerationPipeline.test.js',
  'apps/api/tests/contentPlanOutputQuality.test.js',
  'apps/api/tests/semanticEnrichmentPipeline.test.js',
  'apps/api/tests/enrichmentRoutes.integration.test.js',
  'apps/api/tests/precedentRoutes.integration.test.js',
  'apps/api/tests/precedentStorage.test.js',
  'apps/api/tests/dbClient.test.js',
  'apps/api/tests/dbMigrations.test.js',
  'apps/api/tests/precedentRepositoryDb.live.test.js',
  'apps/api/tests/hybridPrecedentSearch.test.js',
  'apps/api/tests/embeddingVersioning.test.js',
  'apps/api/tests/mlFeatureVersioning.test.js',
  'apps/api/tests/ragQueryCache.test.js',
  'apps/api/tests/precedentReliability.test.js',
  'apps/api/tests/authRoutes.integration.test.js',
  'apps/api/tests/instagramAccess.test.js',
  'apps/api/tests/jobQueue.test.js',
  'apps/api/tests/sseJobQueue.test.js',
  'apps/api/tests/draftStore.test.js',
  'apps/api/tests/draftStore.db.test.js',
  'apps/api/tests/planSnapshotStore.test.js',
  'apps/api/tests/planSnapshotStore.db.test.js',
  'apps/api/tests/pythonJsonWorker.test.js',
  'apps/api/tests/logger.test.js',
  'apps/api/tests/asyncTracing.test.js',
  'apps/api/tests/telemetryRoutes.integration.test.js',
  'apps/api/tests/metrics.test.js'
].map((p) => join(root, p));

const mode = process.argv[2];

/** Avoid parallel test files loading heavy API graphs (ML, planning) at once — OOM on typical laptops. */
const testConcurrency = process.env.NODE_TEST_CONCURRENCY || '1';
const maxOldSpaceMb = process.env.NODE_TEST_MAX_OLD_SPACE_SIZE_MB || '4096';

const mergedNodeOptions = [
  process.env.NODE_OPTIONS,
  `--max-old-space-size=${maxOldSpaceMb}`
]
  .filter(Boolean)
  .join(' ')
  .trim();

const args = [
  '--test',
  `--test-concurrency=${testConcurrency}`,
];
if (mode === 'spec') {
  args.push('--test-reporter=spec');
} else if (mode === 'junit') {
  const outDir = join(root, 'apps', 'api', 'test-results');
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, 'junit.xml');
  args.push('--test-reporter=junit', `--test-reporter-destination=${dest}`);
}

const result = spawnSync(process.execPath, [...args, ...testFiles], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: mergedNodeOptions }
});

if (result.status !== 0) {
  console.error('\n--- Diagnosing failing test file(s) ---');
  for (const file of testFiles) {
    const single = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, NODE_OPTIONS: mergedNodeOptions }
    });
    if (single.status !== 0) {
      const relPath = relative(root, file).replace(/\\/g, '/');
      const errorOutput = `${single.stderr || ''}\n${single.stdout || ''}`.trim();
      const firstErrorLine = errorOutput.split('\n').find((l) => l.includes('AssertionError') || l.includes('Error:') || l.includes('✖')) || 'Test failed';
      console.error(`::error file=${relPath},title=Test Failed::${firstErrorLine.trim()}`);
      console.error(`\n❌ FAILED: ${relPath}\n${errorOutput}\n`);
    }
  }
}

process.exit(result.status === null ? 1 : result.status);
