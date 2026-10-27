import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublicationRows } from '../src/shared/lib/contentPlanExport.js'

test('buildPublicationRows includes full post text, media info and publication metadata', () => {
  const publications = [
    {
      planned_date: '2026-06-01',
      platform: 'vk',
      topic: 'Обзор AI-инструментов',
      format: 'image',
      objective: 'inform',
      key_message: 'AI ускоряет подготовку контента втрое.',
      summary: 'Полный текст поста о внедрении современных AI-инструментов в маркетинг.\n\nВторой абзац с деталями кейса.',
      cta: 'Попробуйте бесплатно по ссылке.',
      tone: 'expert',
      media_prompt: 'High tech dashboard showing AI insights with glowing charts',
      media: {
        kind: 'image',
        url: '/api/plan/media/files/abc1234567890abcdef1234567890abc.png',
        status: 'ready'
      },
      status: 'scheduled',
      post_url: 'https://vk.com/wall-123_456',
      expected_kpi: {
        engagement_rate: 0.052,
        conversion_potential: 0.031,
        reach_potential: 0.45,
        predicted_likes: 120,
        predicted_shares: 25,
        predicted_views: 3500
      }
    },
    {
      planned_date: '2026-06-05',
      platform: 'telegram',
      topic: 'Демонстрация работы алгоритма',
      format: 'video',
      objective: 'educate',
      key_message: 'Показываем алгоритм в действии.',
      summary: 'Видеообзор рабочего процесса за 60 секунд.',
      cta: '',
      tone: 'friendly',
      media_prompt: 'A 4-second video demonstrating interface animation',
      media: {
        kind: 'video',
        url: '/api/plan/media/files/def1234567890abcdef1234567890def.mp4',
        status: 'ready'
      },
      status: 'draft',
      expected_kpi: {
        engagement_rate: 0.08,
        ml_predicted_likes: 210,
        ml_predicted_shares: 40,
        ml_predicted_views: 6000
      }
    }
  ]

  const rows = buildPublicationRows(publications)

  assert.equal(rows.length, 2)

  // First row checks (Image post)
  assert.equal(rows[0]['№'], 1)
  assert.equal(rows[0]['Дата'], '2026-06-01')
  assert.equal(rows[0]['Платформа'], 'VK')
  assert.equal(rows[0]['Тема'], 'Обзор AI-инструментов')
  assert.equal(rows[0]['Формат'], 'image')
  assert.equal(rows[0]['Цель'], 'inform')
  assert.equal(rows[0]['Ключевое сообщение'], 'AI ускоряет подготовку контента втрое.')
  assert.equal(
    rows[0]['Текст поста'],
    'Полный текст поста о внедрении современных AI-инструментов в маркетинг.\n\nВторой абзац с деталями кейса.'
  )
  assert.equal(rows[0]['Призыв'], 'Попробуйте бесплатно по ссылке.')
  assert.equal(rows[0]['Тон'], 'expert')
  assert.equal(rows[0]['Медиа: Тип'], 'image')
  assert.equal(rows[0]['Медиа: Ссылка'], '/api/plan/media/files/abc1234567890abcdef1234567890abc.png')
  assert.equal(rows[0]['Медиа: Промпт'], 'High tech dashboard showing AI insights with glowing charts')
  assert.equal(rows[0]['Вовлечённость %'], '5.2%')
  assert.equal(rows[0]['Прогноз лайков'], '120')
  assert.equal(rows[0]['Прогноз репостов'], '25')
  assert.equal(rows[0]['Прогноз просмотров'], '3500')
  assert.equal(rows[0]['Статус публикации'], 'scheduled')
  assert.equal(rows[0]['Ссылка на публикацию'], 'https://vk.com/wall-123_456')

  // Second row checks (Video post)
  assert.equal(rows[1]['№'], 2)
  assert.equal(rows[1]['Платформа'], 'TELEGRAM')
  assert.equal(rows[1]['Формат'], 'video')
  assert.equal(rows[1]['Текст поста'], 'Видеообзор рабочего процесса за 60 секунд.')
  assert.equal(rows[1]['Медиа: Тип'], 'video')
  assert.equal(rows[1]['Медиа: Ссылка'], '/api/plan/media/files/def1234567890abcdef1234567890def.mp4')
  assert.equal(rows[1]['Медиа: Промпт'], 'A 4-second video demonstrating interface animation')
  assert.equal(rows[1]['Прогноз лайков'], '210')
  assert.equal(rows[1]['Прогноз репостов'], '40')
  assert.equal(rows[1]['Прогноз просмотров'], '6000')
  assert.equal(rows[1]['Статус публикации'], 'draft')
})
