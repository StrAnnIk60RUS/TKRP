function extractBracedJsonObject(trimmed) {
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM не вернул JSON объект');
  }
  return trimmed.slice(start, end + 1);
}

/**
 * Parses strict JSON first (expected when response_format=json_object is used),
 * then falls back to extracting the first `{...}` object from a noisy response.
 *
 * @param {unknown} content
 * @returns {unknown}
 */
export function parseJsonObjectFromLlmContent(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('Пустой ответ от LLM');
  }

  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // Fall back to brace extraction for non-strict responses.
  }

  const extracted = extractBracedJsonObject(trimmed);
  return JSON.parse(extracted);
}

