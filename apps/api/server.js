import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OPENROUTER_API_KEY } from './openrouter.js';
import apiRoutes from './src/app/apiRoutes.js';
import {
  attachRequestContext,
  createCorsOptions,
  createRateLimitMiddleware
} from './src/shared/http/security.js';
import { apiNotFoundHandler, globalErrorHandler } from './src/shared/http/expressHttp.js';
import { closePool, isDatabaseEnabled, query } from './src/shared/db/client.js';
import { ensureInstagramPreviewUser } from './src/modules/auth/services/authStore.js';
import { INSTAGRAM_PREVIEW_USERNAME } from './src/modules/auth/services/instagramAccess.js';
import { getJobQueueStats } from './src/shared/runtime/jobQueue.js';
import { getStorageMetricsSnapshot } from './src/shared/runtime/storageMetrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env only from the project root.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(attachRequestContext);
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: process.env.API_BODY_LIMIT || '10mb' }));
app.use(createRateLimitMiddleware());

app.get('/health', async (req, res) => {
  let dbStatus = 'not_configured';
  let dbHealthy = true;

  if (isDatabaseEnabled()) {
    try {
      await query('SELECT 1');
      dbStatus = 'connected';
    } catch (err) {
      dbStatus = `disconnected: ${err?.message || err}`;
      dbHealthy = false;
    }
  }

  const isHealthy = dbHealthy;
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    service: 'LLM Enrichment Server',
    database: dbStatus,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    request_id: req.requestId,
    cors_origins: process.env.CORS_ALLOWED_ORIGINS || 'localhost defaults',
    api_key_protection: Boolean(process.env.SERVER_API_KEY || process.env.ADMIN_API_KEY),
    job_queue: getJobQueueStats(),
    storage_metrics: getStorageMetricsSnapshot()
  });
});

app.use('/api', apiRoutes);
app.use('/api', apiNotFoundHandler);
app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(`🚀 LLM Enrichment Server запущен на http://localhost:${PORT}`);
  console.log(`📡 LLM API: ${OPENROUTER_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
  console.log(`🗄️ Storage: ${isDatabaseEnabled() ? 'PostgreSQL (USE_DATABASE=true)' : 'JSON-файлы (data/precedents)'}`);
  ensureInstagramPreviewUser(INSTAGRAM_PREVIEW_USERNAME)
    .then((result) => {
      if (result?.created || result?.updated) {
        console.log(`Instagram preview account ${INSTAGRAM_PREVIEW_USERNAME} is ready`);
      }
    })
    .catch((error) => {
      console.error('Не удалось подготовить Instagram preview account:', error?.message || error);
    });
});

async function shutdown(signal) {
  try {
    await closePool();
  } catch (error) {
    console.error(`[shutdown] Ошибка закрытия пула БД (${signal}):`, error?.message || error);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));


