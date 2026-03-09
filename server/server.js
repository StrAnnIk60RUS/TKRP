import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OPENROUTER_API_KEY, DEEPSEEK_MODEL } from './openrouter.js';
import enrichmentRoutes from './src/routes/enrichmentRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LLM Enrichment Server' });
});

app.use('/api', enrichmentRoutes);

app.listen(PORT, () => {
  console.log(`🚀 LLM Enrichment Server запущен на http://localhost:${PORT}`);
  console.log(`📡 OpenRouter API: ${OPENROUTER_API_KEY ? '✅ Настроен' : '❌ Не настроен'}`);
  console.log(`🤖 Модель: ${DEEPSEEK_MODEL}`);
});
