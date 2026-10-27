/**
 * Sentry-style Breadcrumbs collector.
 * Легковесный кольцевой буфер действий пользователя и сетевых вызовов в браузере.
 */

const MAX_BREADCRUMBS = 25;
const breadcrumbs = [];
let listenersInitialized = false;

export function addBreadcrumb(crumb) {
  const entry = {
    timestamp: new Date().toISOString(),
    category: crumb.category || 'default',
    message: crumb.message || '',
    level: crumb.level || 'info',
    data: crumb.data ? JSON.parse(JSON.stringify(crumb.data)) : undefined
  };

  breadcrumbs.push(entry);
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

export function getBreadcrumbs() {
  return [...breadcrumbs];
}

export function clearBreadcrumbs() {
  breadcrumbs.length = 0;
}

function getElementDescriptor(target) {
  if (!target || !target.tagName) return 'unknown';
  const tag = target.tagName.toLowerCase();
  const id = target.id ? `#${target.id}` : '';
  const testId = target.getAttribute('data-testid') ? `[data-testid="${target.getAttribute('data-testid')}"]` : '';
  const name = target.getAttribute('name') ? `[name="${target.getAttribute('name')}"]` : '';
  const text = (target.textContent || '').trim().slice(0, 30);
  const textPart = text && (tag === 'button' || tag === 'a') ? ` ("${text}")` : '';
  return `${tag}${id}${name}${testId}${textPart}`;
}

/**
 * Инициализирует пассивный сбор кликов и переходов пользователя.
 */
export function initBreadcrumbListeners() {
  if (typeof window === 'undefined' || listenersInitialized) return;
  listenersInitialized = true;

  // Слушатель кликов
  window.addEventListener(
    'click',
    (event) => {
      try {
        const target = event.target;
        if (!target) return;
        const interactive = target.closest('button, a, input, select, textarea, [role="button"]');
        if (interactive) {
          // Исключаем ввод паролей из логирования
          if (interactive.type === 'password') {
            addBreadcrumb({
              category: 'ui.click',
              message: 'clicked input[type="password"]'
            });
            return;
          }
          addBreadcrumb({
            category: 'ui.click',
            message: `clicked ${getElementDescriptor(interactive)}`
          });
        }
      } catch {}
    },
    { capture: true, passive: true }
  );

  // Слушатель необработанных JS-ошибок
  window.addEventListener('error', (event) => {
    addBreadcrumb({
      category: 'window.error',
      level: 'error',
      message: event.message || 'Script error',
      data: { filename: event.filename, lineno: event.lineno, colno: event.colno }
    });
  });

  // Слушатель отклоненных Promise
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    addBreadcrumb({
      category: 'promise.rejection',
      level: 'error',
      message: reason?.message || String(reason || 'Unhandled promise rejection')
    });
  });
}
