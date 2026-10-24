const SENSITIVE_KEY_PATTERN =
  /^(password|passwd|secret|token|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|cookie|set-cookie|authorization|auth|proxy-authorization)$/i;

const SENSITIVE_STRING_PATTERNS = [
  /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /(?:api[_-]?key|secret|token)=([a-zA-Z0-9_\-]+)/gi
];

/**
 * Рекурсивно маскирует конфиденциальные данные (пароли, токены, ключи API, cookies).
 * Безопасен к циклическим ссылкам и глубокой вложенности.
 */
export function redactSensitiveData(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    let sanitized = value;
    for (const pattern of SENSITIVE_STRING_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match) => {
        if (match.toLowerCase().startsWith('bearer ')) {
          return 'Bearer [REDACTED]';
        }
        return '[REDACTED]';
      });
    }
    return sanitized;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (depth > 6) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveData(value.message, depth + 1, seen),
      stack: redactSensitiveData(value.stack, depth + 1, seen),
      code: value.code,
      details: value.details ? redactSensitiveData(value.details, depth + 1, seen) : undefined
    };
  }

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitiveData(val, depth + 1, seen);
    }
  }

  return result;
}
