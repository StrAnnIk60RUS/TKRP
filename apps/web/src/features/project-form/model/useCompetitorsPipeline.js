import { useEffect, useState } from 'react';
import {
  enrichCompetitorsData,
  checkEnrichmentServer,
  parseCompetitorByUrl
} from '../../../shared/api/enrichmentService';
import {
  buildEnrichmentDownloadPayload,
  buildEnrichmentToastMessages,
  canEnrichCompetitors,
  isPostAlreadyEnriched,
  mergeParsedCompetitorsFromUrls
} from '../lib/competitorsPipelineUtils';

export function useCompetitorsPipeline(addToast, options = {}) {
  const { isAnalyst = false, isDeveloper = false } = options;
  const isAnalystMode = Boolean(isAnalyst || isDeveloper);
  const [isEnriching, setIsEnriching] = useState(false);
  const [competitorsData, setCompetitorsData] = useState(null);
  const [competitorsFileName, setCompetitorsFileName] = useState(null);
  const [isEnrichmentServerAvailable, setIsEnrichmentServerAvailable] = useState(null);
  const [competitorUrls, setCompetitorUrls] = useState(['']);
  const [isParsingFromUrls, setIsParsingFromUrls] = useState(false);
  // Лимит количества постов, которые будут забирать парсер для каждого конкурента.
  // Значение 'all' означает парсинг всех доступных постов.
  const [postsLimit, setPostsLimit] = useState('10');

  useEffect(() => {
    checkEnrichmentServer().then((available) => {
      setIsEnrichmentServerAvailable(available);
      if (!available) {
        console.warn('Сервер обогащения недоступен. Проверьте backend и переменную VITE_ENRICHMENT_API_URL.');
      }
    });
  }, []);

  const handleRemoveCompetitorsData = () => {
    setCompetitorsData(null);
    setCompetitorsFileName(null);
    addToast('Данные конкурентов удалены', 'info');
  };

  const downloadJsonFile = (dataToDownload, filename, onToast) => {
    const jsonString = JSON.stringify(dataToDownload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
    onToast(`Файл ${filename} скачан`, 'info');
  };

  const handleEnrichCompetitorsData = async (opts = {}) => {
    const { skipDownload = false } = opts
    if (!competitorsData) {
      addToast('Сначала соберите данные конкурентов по ссылкам', 'error');
      return { success: false, reason: 'no_competitors_data' };
    }

    const firstPost = competitorsData.competitors?.[0]?.posts?.[0];
    const alreadyEnriched = isPostAlreadyEnriched(firstPost);
    if (alreadyEnriched) {
      const confirmed = window.confirm(
        'Данные уже выглядят обогащёнными (есть publication_model или семантические поля). Запустить обогащение заново?'
      );
      if (!confirmed) return { success: false, reason: 'cancelled_by_user' };
    }

    setIsEnriching(true);
    addToast('Начало обогащения данных...', 'info');

    let resultData = null;
    let errorData = null;

    try {
      const result = await enrichCompetitorsData(competitorsData);
      resultData = result;

      if (result.success && result.enriched_data) {
        setCompetitorsData(result.enriched_data);
        setCompetitorsFileName(
          competitorsFileName?.replace('.json', '_enriched.json') || 'competitors_data_enriched.json'
        );
        buildEnrichmentToastMessages(result).forEach((msg) => addToast(msg.text, msg.type));
        return { success: true, result };
      } else if (result.enriched_data === null && result.raw_response) {
        buildEnrichmentToastMessages(result).forEach((msg) => addToast(msg.text, msg.type));
        return { success: false, reason: 'invalid_llm_json', result };
      } else if (result.error) {
        throw new Error(result.error);
      } else {
        throw new Error('Неизвестная ошибка при обогащении. Проверьте логи сервера.');
      }
    } catch (error) {
      console.error('Ошибка обогащения данных:', error);
      addToast(`Ошибка обогащения: ${error.message}`, 'error', { traceId: error?.traceId });
      errorData = {
        error: error.message,
        error_stack: error.stack,
        timestamp: new Date().toISOString(),
        original_data: competitorsData
      };
      return { success: false, reason: 'request_failed', error };
    } finally {
      setIsEnriching(false);

      if (!skipDownload) {
        try {
          const { dataToDownload, filename } = buildEnrichmentDownloadPayload({
            resultData,
            errorData,
            competitorsData,
            competitorsFileName
          });
          downloadJsonFile(dataToDownload, filename, addToast);
        } catch (downloadError) {
          console.error('Ошибка при скачивании файла:', downloadError);
          addToast('Не удалось скачать файл', 'error');
        }
      }
    }
  };

  const handleCompetitorUrlChange = (index, value) => {
    setCompetitorUrls((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleAddCompetitorUrl = () => {
    setCompetitorUrls((prev) => [...prev, '']);
  };

  const handleRemoveCompetitorUrl = (index) => {
    setCompetitorUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePostsLimitChange = (value) => {
    setPostsLimit(value);
  };

  const handleParseCompetitorsFromUrls = async () => {
    const urls = competitorUrls.map((u) => u.trim()).filter((u) => u.length > 0);

    if (urls.length === 0) {
      addToast('Добавьте хотя бы одну ссылку конкурента', 'error');
      return;
    }

    if (isEnrichmentServerAvailable === false) {
      addToast('Сервер парсинга и обогащения недоступен. Убедитесь, что сервер запущен.', 'error');
      return;
    }

    setIsParsingFromUrls(true);
    addToast('Запуск парсинга конкурентов по ссылкам...', 'info');

    const successfulResults = [];
    const failedUrls = [];

    // Преобразуем выбранный лимит в числовое значение или "без ограничения"
    const numericLimit =
      postsLimit === 'all' ? null : Number.isNaN(Number(postsLimit)) ? null : Number(postsLimit);

    const parsedByUrl = new Array(urls.length);
    let nextUrlIndex = 0;
    const parseWorker = async () => {
      while (nextUrlIndex < urls.length) {
        const index = nextUrlIndex;
        nextUrlIndex += 1;
        const url = urls[index];
        try {
          const result = await parseCompetitorByUrl(url, numericLimit);
          parsedByUrl[index] = { url, result };
        } catch (error) {
          console.error('Ошибка parse-only для URL', url, error);
          parsedByUrl[index] = { url, error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, urls.length) }, () => parseWorker()));
    for (const entry of parsedByUrl) {
      if (!entry) continue;
      if (entry.error) {
        failedUrls.push({ url: entry.url, reason: entry.error.message });
      } else if (entry.result?.success && entry.result?.competitors_data?.competitors) {
        successfulResults.push(entry.result.competitors_data);
      } else {
        failedUrls.push({ url: entry.url, reason: entry.result?.error || 'Нет competitors_data в ответе' });
      }
    }

    if (successfulResults.length === 0) {
      const firstReason = failedUrls[0]?.reason ? ` Причина: ${failedUrls[0].reason}` : '';
      const firstError = parsedByUrl.find((e) => e?.error)?.error;
      addToast(`Не удалось спарсить ни одного конкурента. Проверьте ссылки.${firstReason}`, 'error', { traceId: firstError?.traceId });
      setIsParsingFromUrls(false);
      return;
    }

    const merged = mergeParsedCompetitorsFromUrls(successfulResults, urls, failedUrls.length);

    setCompetitorsData(merged);
    setCompetitorsFileName('competitors_from_urls.json');
    addToast(
      `Спарсено конкурентов: ${merged.competitors.length}. Неудачных ссылок: ${failedUrls.length}.`,
      'success'
    );

    // Автоматическое обогащение спарсенных данных конкурентов
    {
      setIsEnriching(true);
      addToast('Обогащение данных конкурентов...', 'info');
      try {
        const result = await enrichCompetitorsData(merged);
        if (result.success && result.enriched_data) {
          setCompetitorsData(result.enriched_data);
          setCompetitorsFileName('competitors_from_urls_enriched.json');
          const usageInfo = result.usage ? ` (токенов: ${result.usage.total_tokens || 'нет данных'})` : '';
          addToast(`Данные обогащены автоматически${usageInfo}`, 'success');
          if (result.parse_error?.partial) {
            addToast('Обогащение частичное: одна или несколько частей обработки пропущены.', 'warning');
          }
        } else if (result.error) {
          addToast(`Обогащение не удалось: ${result.error}`, 'error', { traceId: result?.trace_id || result?.traceId });
        }
      } catch (error) {
        console.error('Ошибка автообогащения:', error);
        addToast(`Обогащение не удалось: ${error.message}`, 'error', { traceId: error?.traceId });
      } finally {
        setIsEnriching(false);
      }
    }

    // Скачиваем сырые спарсенные данные в JSON (для аналитика)
    if (isAnalystMode) {
      try {
        downloadJsonFile(merged, 'competitors_from_urls.json', addToast);
      } catch (downloadError) {
        console.error('Ошибка при скачивании файла спарсенных данных:', downloadError);
        addToast('Не удалось скачать файл спарсенных данных', 'error');
      }
    }

    setIsParsingFromUrls(false);
  };

  const clearCompetitors = () => {
    setCompetitorsData(null);
    setCompetitorsFileName(null);
    setCompetitorUrls(['']);
  };

  const canEnrich = canEnrichCompetitors(competitorsData);

  return {
    competitorsData,
    competitorsFileName,
    isEnrichmentServerAvailable,
    competitorUrls,
    postsLimit,
    isParsingFromUrls,
    isEnriching,
    handleRemoveCompetitorsData,
    handleEnrichCompetitorsData,
    handleCompetitorUrlChange,
    handleAddCompetitorUrl,
    handleRemoveCompetitorUrl,
    handlePostsLimitChange,
    handleParseCompetitorsFromUrls,
    clearCompetitors,
    canEnrich
  };
}
