import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OPENROUTER_API_KEY } from './openrouter.js';
import apiRoutes from './src/routes/index.js';
import {
  attachRequestContext,
  createCorsOptions,
  createRateLimitMiddleware
} from './src/http/security.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

app.listen(PORT, () => {
  console.log(`🚀 LLM Enrichment Server запущен на http://localhost:${PORT}`);
  console.log(`📡 LLM API: ${OPENROUTER_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
});
