import { Router } from 'express';
import { enrichCompetitorsData } from '../../openrouter.js';
import { parseAndEnrichByUrl, parseOnlyByUrl } from '../services/parserPipeline.js';

const router = Router();

router.post('/parse', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса'
      });
    }

    console.log(`[${new Date().toISOString()}] Запуск parse-only для URL: ${url}`);
    const result = await parseOnlyByUrl(url);

    return res.json(result);
  } catch (error) {
    console.error('Ошибка в /api/parse:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/parse',
      error_type: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/parse-and-enrich', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Отсутствует или некорректное поле url в теле запроса'
      });
    }

    console.log(`[${new Date().toISOString()}] Запуск parse-and-enrich для URL: ${url}`);
    const result = await parseAndEnrichByUrl(url);

    console.log(
      `[${new Date().toISOString()}] parse-and-enrich завершен. Использовано токенов: ${
        result.usage?.total_tokens || 'N/A'
      }`
    );

    return res.json(result);
  } catch (error) {
    console.error('Ошибка в /api/parse-and-enrich:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера в /api/parse-and-enrich',
      error_type: error.name || 'UnknownError',
      timestamp: new Date().toISOString()
    });
  }
});

router.post('/enrich', async (req, res) => {
  try {
    const { competitors_data } = req.body;

    if (!competitors_data) {
      return res.status(400).json({
        error: 'Отсутствует поле competitors_data в теле запроса'
      });
    }

    if (!competitors_data.competitors || !Array.isArray(competitors_data.competitors)) {
      return res.status(400).json({
        error: 'Неверная структура данных: ожидается массив competitors'
      });
    }

    const competitorsCount = competitors_data.competitors.length;
    const postsCount = competitors_data.competitors.reduce((sum, c) => sum + (c.posts?.length || 0), 0);
    console.log(`[${new Date().toISOString()}] Начало обогащения данных для ${competitorsCount} конкурентов, ${postsCount} постов`);

    const result = await enrichCompetitorsData(competitors_data);
    console.log(`[${new Date().toISOString()}] Обогащение завершено. Использовано токенов: ${result.usage?.total_tokens || 'N/A'}`);

    if (result.parse_error) {
      console.warn('[ВНИМАНИЕ] JSON ответ от LLM невалидный, но данные возвращаются для проверки');
    }

    return res.json({
      success: result.enriched_data !== null,
      ...result
    });
  } catch (error) {
    console.error('Ошибка при обогащении данных:', error);
    console.error('Stack trace:', error.stack);

    return res.status(500).json({
      success: false,
      error: error.message || 'Внутренняя ошибка сервера',
      error_type: error.name || 'UnknownError',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
