import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Генератор большого тестового файла
function generateLargeTestData() {
  const competitors = [];
  const platforms = ['linkedin', 'vk', 'telegram'];
  const competitorNames = [
    'AnalyticsHub', 'DataVision', 'InsightPro', 'BizAnalytics', 'CloudMetrics',
    'DataFlow', 'AnalyticsPro', 'BusinessIntel', 'DataInsight', 'MetricsHub',
    'AnalyticsLab', 'DataCore', 'BusinessMetrics', 'AnalyticsEdge', 'DataSphere'
  ];

  let totalPosts = 0;
  const dateRange = {
    start: '2025-11-01',
    end: '2026-02-25'
  };

  // Генерируем 7-8 конкурентов (уменьшено в два раза)
  for (let i = 0; i < 8; i++) {
    const platform = platforms[i % platforms.length];
    const competitorId = `competitor_${competitorNames[i].toLowerCase().replace(/\s+/g, '')}`;
    const followerCount = Math.floor(Math.random() * 20000) + 5000; // 5K-25K подписчиков
    
    const posts = [];
    const postsCount = Math.floor(Math.random() * 12) + 8; // 8-20 постов на конкурента (уменьшено в два раза)
    
    // Генерируем посты
    for (let j = 0; j < postsCount; j++) {
      const daysAgo = Math.floor(Math.random() * 120); // Последние 120 дней
      const publicationDate = new Date('2026-02-25');
      publicationDate.setDate(publicationDate.getDate() - daysAgo);
      
      const hour = Math.floor(Math.random() * 12) + 8; // 8:00-20:00
      const minute = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, 45
      publicationDate.setHours(hour, minute, 0, 0);
      
      // Генерируем разные типы контента
      const contentTypes = [
        {
          type: 'case_study',
          template: `Кейс: Как ${competitorNames[i]} помог компании увеличить эффективность на ${Math.floor(Math.random() * 40) + 20}% за ${Math.floor(Math.random() * 6) + 2} месяца.\n\nРезультаты:\n✅ Сокращение времени на ${Math.floor(Math.random() * 50) + 30}%\n✅ Рост точности на ${Math.floor(Math.random() * 30) + 15}%\n✅ ROI составил ${Math.floor(Math.random() * 150) + 150}%\n\nПодробнее в комментариях 👇\n\n#КейсСтади #БизнесАналитика #${competitorNames[i]}`,
          metrics: { likes: 150 + Math.floor(Math.random() * 200), views: 5000 + Math.floor(Math.random() * 5000), comments: 25 + Math.floor(Math.random() * 40), shares: 10 + Math.floor(Math.random() * 20) }
        },
        {
          type: 'expert_opinion',
          template: `${Math.floor(Math.random() * 5) + 3} способов улучшить качество бизнес-решений:\n\n${Array.from({ length: Math.floor(Math.random() * 5) + 3 }, (_, idx) => `${idx + 1}. ${['Автоматизируйте', 'Используйте', 'Внедряйте', 'Анализируйте', 'Оптимизируйте'][Math.floor(Math.random() * 5)]} ${['процессы', 'данные', 'инструменты', 'метрики', 'стратегии'][Math.floor(Math.random() * 5)]}`).join('\n')}\n\nКаждый из этих пунктов может значительно повысить эффективность.\n\n#Экспертиза #БизнесАналитика #Советы`,
          metrics: { likes: 100 + Math.floor(Math.random() * 150), views: 4000 + Math.floor(Math.random() * 4000), comments: 15 + Math.floor(Math.random() * 30), shares: 5 + Math.floor(Math.random() * 15) }
        },
        {
          type: 'product_update',
          template: `Новое обновление ${competitorNames[i]} ${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 5)}!\n\nЧто нового:\n✨ ${['Улучшенный', 'Новый', 'Обновленный'][Math.floor(Math.random() * 3)]} ${['алгоритм', 'интерфейс', 'функционал']}\n📊 ${['Новые', 'Улучшенные'][Math.floor(Math.random() * 2)]} ${['графики', 'отчеты', 'дашборды']}\n🔔 ${['Уведомления', 'Интеграции', 'Автоматизация'][Math.floor(Math.random() * 3)]}\n\nОбновление бесплатное для всех пользователей!\n\n#Обновление #${competitorNames[i]} #Новости`,
          metrics: { likes: 80 + Math.floor(Math.random() * 120), views: 3000 + Math.floor(Math.random() * 3000), comments: 10 + Math.floor(Math.random() * 20), shares: 3 + Math.floor(Math.random() * 10) }
        },
        {
          type: 'educational',
          template: `Что такое ${['бизнес-аналитика', 'data science', 'прогнозирование', 'автоматизация аналитики'][Math.floor(Math.random() * 4)]}?\n\n${['Краткое', 'Простое', 'Подробное'][Math.floor(Math.random() * 3)]} объяснение:\n\n${Array.from({ length: 3 }, () => `• ${['Это процесс', 'Это метод', 'Это инструмент'][Math.floor(Math.random() * 3)]} ${['анализа', 'обработки', 'использования'][Math.floor(Math.random() * 3)]} ${['данных', 'информации', 'метрик'][Math.floor(Math.random() * 3)]}`).join('\n')}\n\nУзнайте больше в нашем блоге!\n\n#Обучение #БизнесАналитика #Образование`,
          metrics: { likes: 90 + Math.floor(Math.random() * 130), views: 3500 + Math.floor(Math.random() * 3500), comments: 12 + Math.floor(Math.random() * 25), shares: 4 + Math.floor(Math.random() * 12) }
        },
        {
          type: 'event',
          template: `Приглашаем на ${['вебинар', 'конференцию', 'мастер-класс', 'онлайн-встречу'][Math.floor(Math.random() * 4)]} "${['Как внедрить', 'Секреты', 'Практика'][Math.floor(Math.random() * 3)]} ${['бизнес-аналитики', 'data science', 'автоматизации'][Math.floor(Math.random() * 3)]}"\n\n📅 ${Math.floor(Math.random() * 28) + 1} ${['марта', 'апреля', 'мая'][Math.floor(Math.random() * 3)]}, ${Math.floor(Math.random() * 8) + 14}:00 МСК\n👨‍💼 Спикер: ${['Иван Петров', 'Мария Сидорова', 'Алексей Иванов'][Math.floor(Math.random() * 3)]}\n\nРегистрация: [ссылка]\n\n#Вебинар #Обучение #БизнесАналитика`,
          metrics: { likes: 120 + Math.floor(Math.random() * 180), views: 4500 + Math.floor(Math.random() * 4500), comments: 20 + Math.floor(Math.random() * 35), shares: 8 + Math.floor(Math.random() * 18) }
        },
        {
          type: 'interactive',
          template: `🎯 Опрос: ${['Какая главная проблема', 'Что важнее', 'Какой инструмент'][Math.floor(Math.random() * 3)]} в вашей аналитике?\n\nА) ${['Недостаточно данных', 'Долгая обработка', 'Сложная визуализация'][Math.floor(Math.random() * 3)]}\nБ) ${['Данные в разных системах', 'Нет автоматизации', 'Низкая точность'][Math.floor(Math.random() * 3)]}\nВ) ${['Сложная интеграция', 'Дорогие инструменты', 'Нехватка экспертизы'][Math.floor(Math.random() * 3)]}\n\nНапишите свой вариант в комментариях! 👇\n\n#Опрос #БизнесАналитика #Интерактив`,
          metrics: { likes: 200 + Math.floor(Math.random() * 250), views: 6000 + Math.floor(Math.random() * 6000), comments: 40 + Math.floor(Math.random() * 60), shares: 12 + Math.floor(Math.random() * 25) }
        },
        {
          type: 'news',
          template: `Новости: ${['Компания', 'Стартап', 'Платформа'][Math.floor(Math.random() * 3)]} ${competitorNames[i]} ${['получила', 'запустила', 'анонсировала'][Math.floor(Math.random() * 3)]} ${['новый', 'улучшенный', 'расширенный'][Math.floor(Math.random() * 3)]} ${['функционал', 'сервис', 'инструмент'][Math.floor(Math.random() * 3)]}.\n\n${['Это позволит', 'Теперь пользователи смогут', 'Новая функция'][Math.floor(Math.random() * 3)]} ${['автоматизировать', 'улучшить', 'оптимизировать'][Math.floor(Math.random() * 3)]} ${['процессы', 'работу', 'аналитику'][Math.floor(Math.random() * 3)]}.\n\nПодробнее: [ссылка]\n\n#Новости #${competitorNames[i]} #Анонс`,
          metrics: { likes: 70 + Math.floor(Math.random() * 100), views: 2500 + Math.floor(Math.random() * 2500), comments: 8 + Math.floor(Math.random() * 15), shares: 2 + Math.floor(Math.random() * 8) }
        }
      ];
      
      const contentType = contentTypes[Math.floor(Math.random() * contentTypes.length)];
      const content = contentType.template;
      const metrics = contentType.metrics;
      
      const postTypes = ['text', 'text_with_image', 'video'];
      const postType = postTypes[Math.floor(Math.random() * postTypes.length)];
      
      const hashtags = [
        '#БизнесАналитика', '#DataScience', '#Аналитика', '#Бизнес', 
        '#КейсСтади', '#Экспертиза', '#Обучение', '#Новости'
      ].slice(0, Math.floor(Math.random() * 4) + 2);
      
      posts.push({
        post_id: `${competitorId}_${platform}_${String(j + 1).padStart(3, '0')}`,
        content: content,
        post_type: postType,
        publication_date: publicationDate.toISOString(),
        metrics: metrics,
        hashtags: hashtags,
        mentions: [],
        length: content.length,
        has_media: postType !== 'text',
        media_type: postType === 'text' ? null : (postType === 'video' ? 'video' : 'image'),
        url: `https://${platform}.com/${competitorId}/posts/${j + 1}`
      });
      
      totalPosts++;
    }
    
    competitors.push({
      competitor_id: competitorId,
      name: competitorNames[i],
      platform: platform,
      follower_count: followerCount,
      posts: posts
    });
  }

  const result = {
    parsing_metadata: {
      parsed_at: '2026-02-25T10:00:00Z',
      competitors_count: competitors.length,
      total_posts: totalPosts,
      platforms: platforms,
      date_range: dateRange,
      parser_version: '1.0',
      note: 'Это сырые данные от парсера для тестирования на больших объемах. Поля content_category, tone, engagement_rate и content_strategy будут добавлены после обработки LLM.'
    },
    competitors: competitors
  };

  return result;
}

// Генерируем и сохраняем
const largeData = generateLargeTestData();
const outputPath = path.join(__dirname, '..', '..', 'data', 'input', 'examples', 'competitors_data_large.json');

fs.writeFileSync(outputPath, JSON.stringify(largeData, null, 2), 'utf-8');

console.log('✅ Большой тестовый файл создан!');
console.log(`📁 Файл: ${outputPath}`);
console.log(`📊 Конкурентов: ${largeData.competitors.length}`);
console.log(`📝 Всего постов: ${largeData.parsing_metadata.total_posts}`);
console.log(`💾 Размер файла: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
