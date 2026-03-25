import { useEffect, useState } from 'react';
import {
  enrichCompetitorsData,
  checkEnrichmentServer,
  parseAndEnrichByUrl,
  parseCompetitorByUrl
} from '../../../shared/api/enrichmentService';

export function useCompetitorsPipeline(addToast, options = {}) {
  const { isDeveloper = true } = options
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

  const buildEnrichmentDownloadPayload = ({
    resultData,
    errorData,
    competitorsData: rawCompetitorsData,
    competitorsFileName: currentCompetitorsFileName
  }) => {
    let dataToDownload;
    let filename;

    if (resultData && resultData.enriched_data) {
      dataToDownload = {
        ...resultData.enriched_data,
        _metadata: {
          enriched_at: resultData.metadata?.enriched_at || new Date().toISOString(),
          model: 'llm',
          usage: resultData.usage,
          success: true,
          parse_successful: true
        }
      };
      filename =
        currentCompetitorsFileName?.replace('.json', '_enriched.json') ||
        'competitors_data_enriched.json';
    } else if (resultData && resultData.raw_response) {
      dataToDownload = {
        _warning: 'JSON ответ от LLM невалидный, но данные сохранены для проверки',
        _parse_error: resultData.parse_error,
        _raw_response_from_llm: resultData.raw_response,
        _usage: resultData.usage,
        _metadata: resultData.metadata,
        _original_data: rawCompetitorsData,
        _timestamp: new Date().toISOString()
      };
      filename =
        currentCompetitorsFileName?.replace('.json', '_enriched_INVALID_JSON.json') ||
        'competitors_data_enriched_INVALID_JSON.json';
    } else if (resultData) {
      dataToDownload = {
        _error: 'Данные невалидные или неполные',
        _raw_response: resultData,
        _original_data: rawCompetitorsData,
        _timestamp: new Date().toISOString()
      };
      filename =
        currentCompetitorsFileName?.replace('.json', '_enriched_ERROR.json') ||
        'competitors_data_enriched_ERROR.json';
    } else if (errorData) {
      dataToDownload = errorData;
      filename =
        currentCompetitorsFileName?.replace('.json', '_enrichment_ERROR.json') ||
        'competitors_data_enrichment_ERROR.json';
    } else {
      dataToDownload = {
        _error: 'Неизвестная ошибка',
        _original_data: rawCompetitorsData,
        _timestamp: new Date().toISOString()
      };
      filename =
        currentCompetitorsFileName?.replace('.json', '_enrichment_ERROR.json') ||
        'competitors_data_enrichment_ERROR.json';
    }

    return { dataToDownload, filename };
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
      addToast('Сначала загрузите данные конкурентов', 'error');
      return;
    }

    const firstPost = competitorsData.competitors?.[0]?.posts?.[0];
    if (firstPost?.content_category && firstPost?.tone) {
      const confirmed = window.confirm(
        'Данные уже содержат обогащенные поля (content_category, tone). Хотите обогатить их заново?'
      );
      if (!confirmed) return;
    }

    setIsEnriching(true);
    addToast('Начало обогащения данных через LLM...', 'info');

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
        const usageInfo = result.usage ? ` (использовано токенов: ${result.usage.total_tokens || 'N/A'})` : '';
        addToast(`Данные успешно обогащены!${usageInfo}`, 'success');
      } else if (result.enriched_data === null && result.raw_response) {
        const usageInfo = result.usage ? ` (использовано токенов: ${result.usage.total_tokens || 'N/A'})` : '';
        addToast(`Обогащение завершено, но JSON невалидный. Файл скачан для проверки.${usageInfo}`, 'warning');
      } else if (result.error) {
        throw new Error(result.error);
      } else {
        throw new Error('Неизвестная ошибка при обогащении. Проверьте логи сервера.');
      }
    } catch (error) {
      console.error('Ошибка обогащения данных:', error);
      addToast(`Ошибка обогащения: ${error.message}`, 'error');
      errorData = {
        error: error.message,
        error_stack: error.stack,
        timestamp: new Date().toISOString(),
        original_data: competitorsData
      };
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
      addToast('Сервер парсинга/обогащения недоступен. Убедитесь, что backend запущен.', 'error');
      return;
    }

    setIsParsingFromUrls(true);
    addToast('Запуск парсинга конкурентов по ссылкам...', 'info');

    const successfulResults = [];
    const failedUrls = [];

    // Преобразуем выбранный лимит в числовое значение или "без ограничения"
    const numericLimit =
      postsLimit === 'all' ? null : Number.isNaN(Number(postsLimit)) ? null : Number(postsLimit);

    for (const url of urls) {
      try {
        const result = await parseCompetitorByUrl(url, numericLimit);
        if (result?.success && result?.competitors_data?.competitors) {
          successfulResults.push(result.competitors_data);
        } else {
          failedUrls.push({ url, reason: result?.error || 'Нет competitors_data в ответе' });
        }
      } catch (error) {
        console.error('Ошибка parse-only для URL', url, error);
        failedUrls.push({ url, reason: error.message });
      }
    }

    if (successfulResults.length === 0) {
      addToast('Не удалось спарсить ни одного конкурента. Проверьте ссылки.', 'error');
      setIsParsingFromUrls(false);
      return;
    }

    const merged = {
      parsing_metadata: {
        source_type: 'urls',
        parsed_at: new Date().toISOString(),
        urls,
        successful_count: successfulResults.length,
        failed_count: failedUrls.length
      },
      competitors: []
    };

    successfulResults.forEach((res, idx) => {
      if (Array.isArray(res.competitors)) {
        res.competitors.forEach((comp, compIdx) => {
          merged.competitors.push({
            ...comp,
            competitor_id: comp.competitor_id || `url_${idx + 1}_comp_${compIdx + 1}`
          });
        });
      }
    });

    setCompetitorsData(merged);
    setCompetitorsFileName('competitors_from_urls.json');
    addToast(
      `Спарсено конкурентов: ${merged.competitors.length}. Неудачных ссылок: ${failedUrls.length}.`,
      'success'
    );

    // Для SMM: автоматическое обогащение после парсинга (без кнопки)
    if (!isDeveloper) {
      setIsEnriching(true);
      addToast('Обогащение данных конкурентов...', 'info');
      try {
        const result = await enrichCompetitorsData(merged);
        if (result.success && result.enriched_data) {
          setCompetitorsData(result.enriched_data);
          setCompetitorsFileName('competitors_from_urls_enriched.json');
          const usageInfo = result.usage ? ` (токенов: ${result.usage.total_tokens || 'N/A'})` : '';
          addToast(`Данные обогащены автоматически${usageInfo}`, 'success');
        } else if (result.error) {
          addToast(`Обогащение не удалось: ${result.error}`, 'error');
        }
      } catch (error) {
        console.error('Ошибка автообогащения:', error);
        addToast(`Обогащение не удалось: ${error.message}`, 'error');
      } finally {
        setIsEnriching(false);
      }
    }

    // Скачиваем сырые спарсенные данные в JSON (только для разработчика)
    if (isDeveloper) {
      try {
        const jsonString = JSON.stringify(merged, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'competitors_from_urls.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
        addToast('Файл competitors_from_urls.json скачан', 'info');
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

  const canEnrich =
    !!competitorsData &&
    Array.isArray(competitorsData.competitors) &&
    competitorsData.competitors.length > 0;

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
