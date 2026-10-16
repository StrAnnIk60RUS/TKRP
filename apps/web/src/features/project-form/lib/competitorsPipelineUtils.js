/**
 * Чистые функции конвейера конкурентов (UI / клиент).
 * Покрывают FR табл. 2.1, которые нельзя проверить только через Postman.
 */

export function parseCompetitorsJsonFileContent(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Пустой файл JSON')
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Файл не является валидным JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Ожидается JSON-объект с полем competitors')
  }
  if (!Array.isArray(data.competitors)) {
    throw new Error('Неверная структура: ожидается массив competitors')
  }
  return data
}

export function isPostAlreadyEnriched(post) {
  if (!post || typeof post !== 'object') return false
  return Boolean(
    post.publication_model ||
      (post.topic && post.tone) ||
      (post.content_category && post.tone)
  )
}

export function buildEnrichmentDownloadPayload({
  resultData,
  errorData,
  competitorsData: rawCompetitorsData,
  competitorsFileName: currentCompetitorsFileName
}) {
  let dataToDownload
  let filename

  if (resultData?.enriched_data) {
    dataToDownload = {
      ...resultData.enriched_data,
      _metadata: {
        enriched_at: resultData.metadata?.enriched_at || new Date().toISOString(),
        model: 'llm',
        usage: resultData.usage,
        success: true,
        parse_successful: true,
        partial_enrichment: Boolean(resultData.metadata?.partial_enrichment),
        parse_error: resultData.parse_error || null
      }
    }
    filename =
      currentCompetitorsFileName?.replace('.json', '_enriched.json') ||
      'competitors_data_enriched.json'
  } else if (resultData?.raw_response) {
    dataToDownload = {
      _warning: 'Ответ модели не удалось разобрать, но данные сохранены для проверки',
      _parse_error: resultData.parse_error,
      _raw_response_from_llm: resultData.raw_response,
      _usage: resultData.usage,
      _metadata: resultData.metadata,
      _original_data: rawCompetitorsData,
      _timestamp: new Date().toISOString()
    }
    filename =
      currentCompetitorsFileName?.replace('.json', '_enriched_INVALID_JSON.json') ||
      'competitors_data_enriched_INVALID_JSON.json'
  } else if (resultData) {
    dataToDownload = {
      _error: 'Данные некорректные или неполные',
      _raw_response: resultData,
      _original_data: rawCompetitorsData,
      _timestamp: new Date().toISOString()
    }
    filename =
      currentCompetitorsFileName?.replace('.json', '_enriched_ERROR.json') ||
      'competitors_data_enriched_ERROR.json'
  } else if (errorData) {
    dataToDownload = errorData
    filename =
      currentCompetitorsFileName?.replace('.json', '_enrichment_ERROR.json') ||
      'competitors_data_enrichment_ERROR.json'
  } else {
    dataToDownload = {
      _error: 'Неизвестная ошибка',
      _original_data: rawCompetitorsData,
      _timestamp: new Date().toISOString()
    }
    filename =
      currentCompetitorsFileName?.replace('.json', '_enrichment_ERROR.json') ||
      'competitors_data_enrichment_ERROR.json'
  }

  return { dataToDownload, filename }
}

export function buildEnrichmentToastMessages(result) {
  const messages = []
  if (!result) return messages

  if (result.success && result.enriched_data) {
    const usageInfo = result.usage
      ? ` (использовано токенов: ${result.usage.total_tokens || 'нет данных'})`
      : ''
    messages.push({ type: 'success', text: `Данные успешно обогащены!${usageInfo}` })
    if (result.parse_error?.partial) {
      messages.push({
        type: 'warning',
        text:
          'Часть данных не обработана; для пропущенных постов сохранена базовая семантика.'
      })
    }
  } else if (result.enriched_data === null && result.raw_response) {
    const usageInfo = result.usage
      ? ` (использовано токенов: ${result.usage.total_tokens || 'нет данных'})`
      : ''
    messages.push({
      type: 'warning',
      text: `Обогащение завершено, но ответ модели не удалось разобрать. Файл скачан для проверки.${usageInfo}`
    })
  }

  return messages
}

export function mergeParsedCompetitorsFromUrls(successfulResults, urls = []) {
  const merged = {
    parsing_metadata: {
      source_type: 'urls',
      parsed_at: new Date().toISOString(),
      urls,
      successful_count: successfulResults.length,
      failed_count: 0
    },
    competitors: []
  }

  successfulResults.forEach((res, idx) => {
    if (!Array.isArray(res?.competitors)) return
    res.competitors.forEach((comp, compIdx) => {
      merged.competitors.push({
        ...comp,
        competitor_id: comp.competitor_id || `url_${idx + 1}_comp_${compIdx + 1}`
      })
    })
  })

  return merged
}

export function canEnrichCompetitors(competitorsData) {
  return (
    !!competitorsData &&
    Array.isArray(competitorsData.competitors) &&
    competitorsData.competitors.length > 0
  )
}

export function shouldBlockWhenBackendUnavailable(isEnrichmentServerAvailable) {
  return isEnrichmentServerAvailable === false
}
