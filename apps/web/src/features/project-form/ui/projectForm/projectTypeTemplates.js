/**
 * Шаблоны начальных значений формы под тип проекта
 */
import { initialFormData } from './formConfig'

function addMonthsIso(months) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function computeMinPublications(startIso, endIso, postsPerWeek) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const days = Math.max(1, Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1)
  return String(Math.max(1, Math.round((postsPerWeek * days) / 7)))
}

function buildTimeline(months, postsPerWeek) {
  const start = new Date().toISOString().slice(0, 10)
  const end = addMonthsIso(months)
  return {
    contentPlanStartDate: start,
    contentPlanEndDate: end,
    minPublications: computeMinPublications(start, end, postsPerWeek)
  }
}

const templates = {
  saas: {
    label: 'SaaS',
    description: 'Облачное ПО, подписка',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'Разработка облачного ПО для бизнеса. Продукт распространяется по подписке (SaaS).',
      projectName: 'SaaS-продукт',
      projectDescription:
        'SaaS-платформа для автоматизации бизнес-процессов. Подписка включает обновления, поддержку и масштабирование.',
      projectGoals:
        'Привлечение B2B-клиентов через экспертный контент, демонстрацию кейсов внедрения и сравнение с аналогами.',
      consumerCategory: 'B2B',
      publicationFrequency: '3-4_per_week',
      ...buildTimeline(3, 3.5),
      contentFormats: ['text', 'image', 'video'],
      platforms: ['linkedin', 'vk']
    }
  },
  outsourcing: {
    label: 'Аутсорс',
    description: 'Разработка на заказ',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'Аутсорсинг разработки ПО: веб, мобильные приложения, интеграции, поддержка.',
      projectName: 'Разработка на заказ',
      projectDescription:
        'Команда разработки на заказ. Кейсы, стек технологий, процессы и подход к доставке проектов.',
      projectGoals:
        'Позиционирование как надёжного подрядчика, привлечение заказчиков через портфолио и экспертизу.',
      consumerCategory: 'B2B',
      publicationFrequency: '2-3_per_week',
      ...buildTimeline(3, 2.5),
      contentFormats: ['text', 'image', 'video'],
      platforms: ['linkedin', 'vk']
    }
  },
  edtech: {
    label: 'EdTech',
    description: 'Образовательные продукты',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'Образовательные технологии: онлайн-курсы, платформы обучения, тренажёры.',
      projectName: 'Образовательная платформа',
      projectDescription:
        'Образовательная платформа для освоения новых навыков. Курсы, практика, сертификация.',
      projectGoals:
        'Привлечение учеников, демонстрация результатов обучения, экспертный контент и лид-магниты.',
      consumerCategory: 'B2C',
      publicationFrequency: '3-4_per_week',
      ...buildTimeline(3, 3.5),
      contentFormats: ['text', 'video', 'image'],
      platforms: ['vk', 'linkedin']
    }
  },
  fintech: {
    label: 'FinTech',
    description: 'Финансовые технологии',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'Финансовые технологии: платёжные решения, автоматизация финансов, аналитика.',
      projectName: 'FinTech-решение',
      projectDescription:
        'FinTech-продукт для бизнеса или частных лиц. Безопасность, соответствие регуляторике.',
      projectGoals:
        'Позиционирование надёжного решения, доверие аудитории, кейсы и разбор регуляторики.',
      consumerCategory: 'B2B',
      publicationFrequency: 'weekly',
      ...buildTimeline(3, 1),
      contentFormats: ['text', 'image'],
      platforms: ['linkedin', 'vk']
    }
  },
  b2b_service: {
    label: 'B2B-сервис',
    description: 'Сервисы для бизнеса',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'B2B-сервисы: консалтинг, автоматизация, интеграции, аналитика для компаний.',
      projectName: 'B2B-сервис',
      projectDescription:
        'Сервис для бизнеса: оптимизация процессов, автоматизация, отчётность и аналитика.',
      projectGoals:
        'Привлечение корпоративных клиентов через экспертный контент, кейсы и вебинары.',
      consumerCategory: 'B2B',
      publicationFrequency: '3-4_per_week',
      ...buildTimeline(3, 3.5),
      contentFormats: ['text', 'image', 'video'],
      platforms: ['linkedin', 'vk']
    }
  },
  marketplace: {
    label: 'Marketplace',
    description: 'Маркетплейс, площадка',
    formData: {
      ...initialFormData,
      producerName: 'ООО «Компания»',
      producerActivitySpecification:
        'Маркетплейс: площадка для связи поставщиков и покупателей, комиссионная модель.',
      projectName: 'Маркетплейс',
      projectDescription:
        'Маркетплейс в нише. Удобство для покупателей, привлечение продавцов, экосистема.',
      projectGoals:
        'Рост GMV, привлечение и удержание и продавцов, и покупателей через контент.',
      consumerCategory: 'B2C',
      publicationFrequency: '3-4_per_week',
      ...buildTimeline(3, 3.5),
      contentFormats: ['text', 'image', 'video'],
      platforms: ['vk', 'linkedin']
    }
  }
}

export const PROJECT_TYPE_OPTIONS = Object.entries(templates).map(([value, t]) => ({
  value,
  label: t.label,
  description: t.description
}))

export function getFormDataByProjectType(projectType) {
  const t = templates[projectType]
  return t ? { ...t.formData } : null
}

export default templates
