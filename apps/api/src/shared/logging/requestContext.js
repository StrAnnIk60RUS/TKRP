import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();

/**
 * Возвращает текущий контекст запроса (trace_id, requestId, user_id, path и т.д.)
 * или пустой объект, если контекст не активен.
 */
export function getTraceContext() {
  return requestContext.getStore() || {};
}

/**
 * Запускает функцию внутри асинхронного контекста трассировки.
 */
export function runWithContext(context, fn) {
  return requestContext.run(context, fn);
}
