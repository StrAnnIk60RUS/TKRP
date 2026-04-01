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
import { runRuntimeRetentionOnStartup } from './src/shared/runtime/runtimeRetention.js';
import {
  apiNotFoundHandler,
  globalErrorHandler
} from './src/shared/http/expressHttp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env only from the project root.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(attachRequestContext);
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: process.env.API_BODY_LIMIT || '10mb' }));
app.use(createRateLimitMiddleware());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LLM Enrichment Server',
    request_id: req.requestId,
    cors_origins: process.env.CORS_ALLOWED_ORIGINS || 'localhost defaults',
    api_key_protection: Boolean(process.env.SERVER_API_KEY || process.env.ADMIN_API_KEY)
  });
});

app.use('/api', apiRoutes);
app.use('/api', apiNotFoundHandler);

app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(`🚀 LLM Enrichment Server запущен на http://localhost:${PORT}`);
  console.log(`📡 LLM API: ${OPENROUTER_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
  void runRuntimeRetentionOnStartup();
});
