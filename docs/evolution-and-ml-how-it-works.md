# Как работает эволюция постов и контент‑планов (TKRP)

Этот документ описывает полный “энд‑ту‑энд” цикл в TKRP: как формируются данные (база прецедентов), как строятся признаки, как обучаются/используются нейросети, и как генетические алгоритмы (GA) оптимизируют сначала контент‑план, затем отдельные посты.

## 0. Термины

- **Прецеденты (precedents)**: наблюдения конкурентов, которые мы сохраняем в локальное хранилище: `publications` (посты) и `content_plans` (observed content plans конкурентов). Используются и для поиска (RAG), и для обучения surrogate‑моделей.
- **Черновик плана**: контент‑план, сгенерированный LLM по skeleton’у и RAG‑контексту.
- **Эволюция (evolution)**: 2‑уровневый GA:
  - **Stage 1**: GA оптимизирует “структуру” контент‑плана (какие `topic/format/objective/tone` ставить в каждый slot публикации) по fitness‑функции.
  - **Stage 2**: для каждого пост‑slot GA оптимизирует параметры “текста/онтологических признаков” (вектор пост‑фич), чтобы максимизировать прогноз лайков и согласовать стиль с контекстом слота.
- **Онтология**: агрегированная схема связей вида `topic -> audience`, `format -> objective`, и т.п., агрегируемая из прецедентов. В текущей реализации онтология влияет на fitness‑функции как источники согласованности/соответствия.

## 1. Откуда берутся данные: база постов и контент‑планов

### 1.1. Где хранятся прецеденты

Локальное хранилище прецедентов реализовано в:
- `apps/api/src/modules/precedents/repositories/precedentRepository.js`

Там же выполняется:
- вставка/обновление элементов,
- (опционально) semantic dedup,
- вычисление и сохранение эмбеддингов для retrieval (RAG).

Формально есть две коллекции:
- **`publications`** — посты конкурентов,
- **`content_plans`** — observed content plans конкурентов (в виде schedule/планов).

Эмбеддинги используются для retrieval‑ранжирования, а **для обучения нейросетей** строятся отдельные feature‑вектора из полей объектов.

### 1.2. Как прецеденты попадают в хранилище

1. Сначала парсится/обогащается информация о конкурентах (LLM enrichment).
2. Далее выполняется persist:
   - `persistPrecedents(enrichedData, options)` в `precedentRepository.js`.
3. Внутри `persistPrecedents`:
   - публикации конкурентов собираются в `publications`,
   - observed plans собираются в `content_plans`,
   - missing items эмбеддингятся,
   - items upsert’ятся по ключам `publication_id` и `plan_id`.

### 1.3. Надёжность прецедентов

Чтобы учитывать качество retrieval/данных, вычисляется **reliability** в:
- `apps/api/src/modules/precedents/services/precedentReliabilityService.js`

Reliability — взвешенная сумма:
- retrieval_score (релевантность),
- completeness (полнота полей),
- source_trust (доверие к источнику).

Эта reliability сохраняется вместе с результатом поиска и далее используется:
- в draft‑контексте (когда LLM skeleton собирает rag‑контекст),
- и в fitness‑функциях эволюции как prior.

## 2. Когда и какие нейросети обучаются

В TKRP используются **surrogate‑модели**, предсказывающие:
- **лайки одного поста**: модель `post_likes_model.joblib`,
- **лайки всего контент‑плана**: модель `content_plan_likes_model.joblib`.

Код обучения и предсказаний — единый python‑скрипт:
- `tools/ml/engagement_model.py`

### 2.1. Где лежат веса

Веса сохраняются в локальной папке:
- `data/ml/`

Конкретно:
- `data/ml/post_likes_model.joblib`
- `data/ml/content_plan_likes_model.joblib`

Также рядом сохраняются метаданные:
- `post_likes_model_metadata.json`
- `content_plan_likes_model_metadata.json`

Эти метаданные содержат `feature_dim` и `feature_names`, что помогает поддерживать согласованность feature‑инженеринга.

### 2.2. Когда запускается training

Обучение запускается в сервисе:
- `apps/api/src/modules/ml/services/relevancePredictionService.js`

Логика `ensureModelTrained(modelKey)`:
- если файла модели нет (или `forceTrain: true`), модель обучается,
- иначе используется существующая joblib‑модель.

Есть ещё режим auto‑train:
- в `persistPrecedents(...)` вызывается `trainRelevanceModel()` если в хранилище были изменения и `ML_AUTO_TRAIN_AFTER_INGESTION !== 'false'`.

Есть API‑эндпоинты для принудительного обучения в:
- `apps/api/src/modules/ml/routes/mlRoutes.js`
  - `POST /api/ml/relevance/train`
  - `POST /api/ml/relevance/reembed-and-train`

### 2.3. Как именно обучается модель (python)

В `tools/ml/engagement_model.py`:
1. Строится `X` (features) и `y` (targets).
2. Targets всегда clamp’ятся в неотрицательный диапазон и обучаются с transform:
   - регрессор обучается на `log1p(y)`,
   - предсказания переводятся обратно `expm1`.
3. Признаки нормализуются `StandardScaler`.
4. Используется `MLPRegressor`:
   - `hidden_layer_sizes=(64, 32)`,
   - `alpha=0.001`,
   - `learning_rate_init=0.001`,
   - `max_iter=1200`,
   - early stopping включается при достаточном числе сэмплов.

После обучения модель сериализуется в joblib + записываются метаданные (feature_dim, feature_names, summary target range).

## 3. Как строится dataset для обучения

Dataset строится в:
- `apps/api/src/modules/ml/services/ml/ontologyFeatureEngineering.js`

Функция:
- `buildMlTrainingDatasets(snapshot)`

Внутри она возвращает:
- `postDataset: { featureNames, features, targets }`
- `contentPlanDataset: { featureNames, features, targets }`

### 3.1. Модель постов: dataset

Каждый элемент обучающей выборки — это **один observed publication** конкурента.

Признаки берутся функцией:
- `buildPostFeatureVector(publication, options)`

Список признаков:
- `POST_FEATURE_NAMES` (в текущей конфигурации 36 признаков)

Они включают:
- детерминированные текстовые/структурные метрики (списки, эмфазы, читабельность, грамматика),
- семантические признаки из enrichment и SPCJ (например `spcj`‑dimension‑derived),
- tone onehot (`tone_onehot_0...4`),
- `creativity_from_best_plan`.

Target:
- лайки поста (берутся из `raw_metrics.likes` или из snapshot поля, clamp’ятся в неотрицательное).

### 3.2. Модель контент‑плана: dataset

Для модели плана важно, что она обучается не на “разметке slot’ов постфактум”, а на observed content plan schedule.

В текущей реализации dataset строится так:
1. Snapshot группируется по контексту (competitor + platform) через `groupSnapshotByContext`.
2. Для каждого observed plan берётся его schedule:
   - если schedule элементов достаточно — они превращаются в “публикации‑подписи” (stub) функцией `createPlanPublicationStub`,
   - если schedule пуст — fallback к publications.
3. Признаки плана считаются функциями:
   - `buildPlanFeatureMap(schedulePublications, { durationDays, expectedPlatforms, targetAudience })`
   - дальше вектором `buildPlanFeatureVector(...)`.
4. Target для плана — `estimatePlanTargetLikes(...)`:
   - если у schedulePublications есть likes — суммируем,
   - иначе используем “средний engagement из контекста” умноженный на размер schedule,
   - либо используем avg_engagement_rate из content_plan_model (как дополнительный fallback).

Признаки плана: `PLAN_FEATURE_NAMES` (сейчас 12).

## 4. Как работает feature engineering для плана (контент‑план)

`PLAN_FEATURE_NAMES` сейчас:
- `unique_topics`
- `unique_tones`
- `avg_creativity`
- `cta_share`
- `posts_count`
- `duration_days`
- `format_entropy`
- `objective_entropy`
- `audience_coverage`
- `platform_coverage`
- `topic_recurrence`
- `timeline_density`

Что они значат на практике:

### 4.1. Энтропия форматов/целей

- `format_entropy` и `objective_entropy` считаются как нормированная entropy распределения значений по schedule slots.
- Если все slots одного формата — entropy 0.
- Если форматы распределены равномерно — entropy ближе к 1.

### 4.2. Coverage

- `audience_coverage` — доля целевых audience‑сегментов, покрытых слотовыми audience‑сегментами (или fallback на долю, если нет явного targetAudience).
- `platform_coverage` — доля ожидаемых платформ, присутствующих в slots.

### 4.3. Рекурренс и плотность по таймлайну

- `topic_recurrence` — насколько повторяются темы (повторы после первого экземпляра относительно числа слотов).
- `timeline_density` — отношение количества дат/уникальных дат к длительности плана.

## 5. Retrieval: как строится контекст для черновика

Перед эволюцией создаётся черновик плана:
1. UI формирует `rag_query` из формы (`buildRagQueryFromForm` в `planUtils.js`).
2. Выполняется поиск прецедентов:
   - `apps/api/src/modules/precedents/repositories/precedentRepository.js`
   - retrieval по embedding cosine similarity (если есть embeddings),
   - иначе fallback на token overlap.
3. Результаты поиска обогащаются `reliability`.

## 6. Stage 0: генерация draft плана (RAG -> LLM)

Черновик генерируется в:
- `apps/api/src/modules/planning/services/draftPlanGenerationPipeline.js`

Ключевые шаги:
1. `generateSkeleton(...)`:
   - LLM возвращает skeleton план‑структуры.
2. `repairSkeleton(...)`:
   - нормализует платформы/форматы/даты,
   - обеспечивает допустимые слоты.
3. `generateMonthlyPublications(...)`:
   - LLM возвращает публикации по batch’ам.
4. После сборки draft:
   - запуск ML‑предсказания engagement_rate и ontology_features для каждого post:
     - `predictEngagementRatesForGeneratedPublications` в `relevancePredictionService.js`.

Затем draft валидируется и отправляется дальше в GA эволюцию.

## 7. Эволюция Stage 1: оптимизация контент‑плана (GA по “геному плана”)

Реализация:
- `apps/api/src/modules/planning/services/evolutionary/planEvolution.js`

### 7.1. Что именно оптимизируется

GA “перегенерирует” slots контент‑плана, но без переписывания текста постов:
- выбираются значения для каждого slot:
  - `topic`
  - `format`
  - `objective`
  - `tone`
  - `cta` (ген/флаг hasCta)
  - `creativity` (число из дискретного набора)

### 7.2. Representation (геном)

Геном — это массив слотов. Для каждого слота — ген:

`[topic, format, objective, tone, hasCta, creativity]`

Количество генов = `targetPostCount` (сколько слотов в плане по horizon и posts_per_week / min_publications).

CTA и creativity имеют свои домены:
- `CTA_GENE_VALUES = [0, 1]`
- `CREATIVITY_GENE_VALUES = [0.25, 0.5, 0.75, 1]`

### 7.3. Откуда берутся домены значений (gene domains)

`buildDomains(...)` строит домены из:
- текущего draft плана (его topics/formats/objectives/tones),
- и надёжных прецедентов из retrieval.

Сами “темы” частично расширяются relevancy‑фильтром по keyword overlap (`scoreTextRelevance`).

### 7.4. Apply genome -> candidate план

`applyGenomeToPlan(...)` создаёт candidate plan:
- копирует base publication (из draft),
- заменяет topic/format/objective/tone/cta/ontology_features,
- протаскивает audience_segments (используя ontology topic->audience связи, если они есть).

### 7.5. Fitness function Stage 1

Fitness — это:
- ML прогноз лайков плана (content_plan model) — прогнозируемый скор,
- затем к нему добавляются bonus‑компоненты согласованности/coverage,
- и вычитаются penalty‑компоненты нарушений целевых ограничений и “плохой” структуры.

В коде видно:
1. `predictContentPlanLikesByFeatureVectors(featureVectors)`
2. `capPlanPredictedLikes(...)` (ограничение предсказаний по metadata target_summary max)
3. Penalties:
   - `weeklyPenalty` по расхождению posts_per_week относительно цели (posts_per_week_tolerance),
   - `topicPenalty` (повторы тем, иностранные темы, низкое разнообразие),
   - `ctaPenalty` (не превышать разумную долю CTA и не уходить от draft share слишком сильно),
   - `boundedPrediction.extrapolationPenalty` (если модель “улетела” выше cap).
4. Bonuses:
   - `audienceAlignment`
   - `objectiveCoverage`
   - `formatMixFit`
   - `ontologyConsistency`
   - `noveltyBalance`
   - `calendarConsistency` (fits по плотности/частоте)
   - `platform_coverage_bonus` и `reliability_prior` (prior из retrieval reliability).

Финальный score формируется как:
`score = cappedPredictedLikes + compositeBonus - penalty`.

### 7.6. Что отправляется дальше

Stage 1 возвращает:
- `optimizedPlan` (структуру публикаций со слотами),
- `planFeatureMap` (вычисленные 12 план‑признаков),
- `predictedLikes` (ML forecast),
- history GA (trace поколений).

## 8. Эволюция Stage 2: оптимизация постов (GA по вектору пост‑фич)

Реализация:
- `apps/api/src/modules/planning/services/evolutionary/postEvolution.js`

### 8.1. В чём GA “копает”

В Stage 2 мы оптимизируем **не текст как строки**, а **вектор фич** поста (`POST_FEATURE_NAMES`), который:
- включает контролируемые элементы:
  - `has_cta`,
  - `tone_onehot_*`,
  - `creativity`,
  - текстовые “метрики качества/структуры” (через ремонт/допущенные значения).

Параллельно прогноз лайков для кандидата берётся через post‑likes surrogate model:
- `predictPostLikesByFeatureVectors` (post model).

### 8.2. Representation (индивидуум)

Индивидуум — массив длины `POST_FEATURE_NAMES.length`, где GA меняет значения только в подмножестве “управляемых” индексов (`buildAllowedValues(index)`), а “tone_onehot” восстанавливается в `repairGenome(...)`.

CTA index — `CTA_INDEX = 20`.
Tone onehot индексы — диапазон `TONE_START = 24` .. `TONE_END = 28`.

### 8.3. Slot-aware контекст

Stage 2 учитывает контекст слота:
- `targetToneIndex` — из `publication.tone`,
- `ctaPreference` — из `publication.objective`:
  - convert/retain => CTA required,
  - engage/brand_building => CTA preferred,
  - иначе => CTA avoid.

Это встраивается в fitness как:
- `ctaAlignment` и `tonePenalty`.

### 8.4. Fitness function Stage 2

Для каждого кандидата в GA:
1. Считается `predictedLikes` post model.
2. Делается `realism penalty`:
   - deviation penalty относительно base vector,
   - penalty за низкое качество (grammar/tech/readability),
   - penalty за extrapolation overflow,
   - CTA penalty и tone penalty по предпочтению слота.
3. Добавляется alignment bonus:
   - творчество vs `planFeatureMap.avg_creativity`,
   - грамматика/quality,
   - совпадение tone onehot с target tone,
   - совпадение CTA с предпочтением слота.

Финальный score:
`score = effectivePredictedLikes + alignmentBonus - realismPenalty`.

### 8.5. Как формируется итоговый план с публикациями

`fillPlanWithBestPublication(...)` собирает финальный список публикаций плана:
- выбираются “архетипы” из результатов GA по каждому слоту,
- CTA назначается не случайно, а по приоритету слотов и `cta_share` плана:
  - обязательные CTA слоты выбираются в первую очередь (`resolveCtaPreference`),
  - затем добираются до target share.

Итоговая публикация:
- получает `ontology_features` из лучшего вектора,
- получает `cta` строку только если CTA включён в featureMap,
- получает `expected_kpi` через `estimatePublicationKpiFromLikes`.

## 9. Как вычисляется финальный прогноз “на весь план”

После того как Stage 2 “заполняет” публикации, вычисляется final predicted_total_likes:
- в `hierarchicalGa.js` вызывается:
  - `predictContentPlanLikes(...)`

Туда передаётся:
- заполненные publication’ы,
- и параметры `expectedPlatforms`/`targetAudience` (чтобы feature map совпадал с тем, чем model обучалась/ожидает).

## 10. Важные параметры (что означает и откуда берётся)

### 10.1. Параметры GA (общие)

В UI конфиг GA собирается в:
- `apps/web/src/features/project-form/ui/projectForm/formUtils.js` (`buildGaConfigFromForm`)

Обычно используются:
- `populationSize`: размер популяции,
- `maxGenerations`: максимум поколений,
- `stagnationGenerations`: порог стагнации,
- `eliteSize`: число лучших, которые сохраняются в следующее поколение,
- `tournamentSize`: размер турнира для выбора родителей,
- `crossoverProbability`: вероятность crossover,
- `mutationProbability`: вероятность mutation.

Seed:
- позволяет воспроизводить эволюцию.

### 10.2. Constraints

`posts_per_week` и `posts_per_week_tolerance` задают то, насколько сильно fitness штрафует план, который публикует слишком часто/редко относительно цели.

`min_publications` используется как нижняя граница.

### 10.3. Параметры, которые влияют на fit “структурно”

В Stage 1:
- `topicPenalty` и `ctaPenalty` —
  - защищают от деградации разнообразия и “слишком много CTA”.

В Stage 2:
- `realism penalty` —
  - заставляет оптимизацию вектора не уходить далеко от “базового” шаблона слота,
  - штрафует за ухудшение качества признаков.

## 11. Частые вопросы

### 11.1. Эволюция меняет тексты или только “признаки”?

В текущей реализации GA меняет **признаки/вектор фич**, а не непосредственно текст.
Затем эти признаки используются для:
- включения CTA,
- выбора tone/ontology_features,
- прогнозирования лайков surrogate‑моделью.

Текстовые строки (в draft/generation) получаются LLM‑ом на этапе draft.

### 11.2. Почему веса сохраняются, но эволюция не “тренирует” сети?

Эволюция использует уже обученные surrogate‑модели для:
- предсказания лайков,
- скоринга кандидатов.

Training происходит отдельно (lazy train или auto train после ingestion или ручные API).

## 12. Ссылки на ключевые файлы

- Retrieval/RAG:
  - `apps/api/src/modules/precedents/repositories/precedentRepository.js`
  - `apps/api/src/modules/precedents/services/precedentReliabilityService.js`
- Генерация draft (RAG -> LLM):
  - `apps/api/src/modules/planning/services/draftPlanGenerationPipeline.js`
- Feature engineering и dataset:
  - `apps/api/src/modules/ml/services/ml/ontologyFeatureEngineering.js`
- surrogate models (Python):
  - `tools/ml/engagement_model.py`
- Prediction service:
  - `apps/api/src/modules/ml/services/relevancePredictionService.js`
- GA Stage 1 (plan):
  - `apps/api/src/modules/planning/services/evolutionary/planEvolution.js`
- GA Stage 2 (posts):
  - `apps/api/src/modules/planning/services/evolutionary/postEvolution.js`
- Оркестрация эволюции:
  - `apps/api/src/modules/planning/services/evolutionary/hierarchicalGa.js`

## 13. Точные компоненты fitness (практически “что влияет на score”)

Ниже — как реально формируется score в коде Stage 1 и Stage 2. Это важно, потому что “объектив” в GA — ключ к тому, почему алгоритм выбирает конкретные структуры.

### 13.1. Stage 1 (GA контент‑плана): score = predictedLikes + compositeBonus - penalty

В `planEvolution.js` кандидат‑план для каждого индивидума создаётся через:
- `applyGenomeToPlan(...)` (геном → слоты `topic/format/objective/tone/cta/creativity`)

Далее для каждого кандидата:
1. Получаем ML‑оценку плана:
   - `predictContentPlanLikesByFeatureVectors(featureVectors)`
   - затем делаем cap:
     - `capPlanPredictedLikes(...)` — ограничение сверху по `metadata.target_summary.max` (с запасом 1.15×).
2. Считаем penalty‑часть:
   - `weeklyPenalty`
     - оцениваем `actualPostsPerWeek` по `posts_count` и `duration_days`,
     - считаем `weeklyDelta = abs(actual - target) / target`,
     - если `weeklyDelta > postsPerWeekTolerance`, штраф больше (`*250`), иначе меньше (`*60`).
   - `topicPenalty = calculateTopicPenalty(...)`
     - штраф за повторы тем (повтор сверх 1 экземпляра),
     - штраф за “иностранные” темы (которые не входят в набор допустимых `draftTopics`),
     - штраф за низкое diversity (когда уникальных тем меньше ожидаемого).
   - `ctaPenalty`
     - сначала ограничиваем “верх” доли CTA относительно draft:
       - `ctaUpperBound = max(0.4, draftCTAshare)`
     - штраф за превышение:
       - `max(0, cta_share - ctaUpperBound) * 240`
     - и за разницу с draft:
       - `abs(cta_share - draftCTAshare) * 45`
   - плюс штраф за “экстраполяцию” модели:
     - `boundedPrediction.extrapolationPenalty`
3. Считаем compositeBonus‑часть (то, что заменяет прежнюю “один‑скор” логику):
   - `audienceAlignment` (consistency по topic→audience связям)
   - `objectiveCoverage` (насколько цели кандидата покрывают цели draft)
   - `formatMixFit` (похожесть mix по формату относительно draft и precedent)
   - `ontologyConsistency` (поддержка objective для каждого format через `format->objective`)
   - `noveltyBalance` (компромисс: быть достаточно новым vs не выпадать из precedent/draft)
   - `calendarConsistency` (fits по частоте/плотности относительно horizon)
   - `platform_coverage_bonus = featureMap.platform_coverage * 18`
   - `reliability_prior = precedentContext.avgReliability * 12`

Итог:
- `score = cappedPredictedLikes + compositeBonus - (weeklyPenalty + topicPenalty + ctaPenalty + extrapolationPenalty)`

Отдельно в `meta` сохраняется breakdown (чтобы UI мог показывать причины):
- `audience_alignment, objective_coverage, format_mix_fit, ontology_consistency, novelty_balance, calendar_consistency`
- `reliability_prior`
- penalty breakdown: `weekly_penalty, topic_penalty, cta_penalty`.

### 13.2. Откуда берутся сигналы онтологии для Stage 1

В `planEvolution.js` перед построением доменов/fitness строится `precedentContext` через:
- `buildPrecedentContext(precedentPublications, draftContentPlan)`

Там:
1. Берётся retrieval‑результат прецедентов (его элементы имеют `score` и `reliability`).
2. Строится онтология на основе raw publications:
   - `buildOntologyFromSnapshot({ publications: rawPublications, content_plans: [] })`
3. Из триплетов вытаскиваются две структуры:
   - `topicAudienceMap` из triples `targets_audience`
   - `formatObjectiveMap` из triples `supports_objective`
4. Отбор “надёжных публикаций”:
   - `reliability >= 0.55 || score >= 0.6`

И уже эти карты используются для:
- соответствия аудитории кандидата (`audienceAlignment`),
- согласованности objective относительно формата (`ontologyConsistency`).

### 13.3. Stage 2 (GA постов): score = effectivePredictedLikes + alignmentBonus - realismPenalty

В `postEvolution.js` на уровне каждого поста:
1. База вектора:
   - `baseVector = buildPostFeatureVector(publication, { tonesCount, creativityFromBestPlan })`
2. Для каждого кандидата GA:
   - ремонтируем genome в допустимые дискретные значения (`repairGenome`),
   - делаем predict лайков:
     - `predictPostLikesByFeatureVectors(repaired, { forceTrain: false })`
   - считаем realism penalty через:
     - `deviationPenalty` (L1‑отклонение первых 34 признаков vs base × 4.5),
     - штрафы за grammar/tech/readability/idea clarity/creativity,
     - штраф за extrapolation overflow,
     - штраф за CTA/tone по `slotContext`,
     - итоговая penalty = deviation + quality + extrapolation + ctaPenalty + tonePenalty.
3. alignmentBonus:
   - `creativityAlignment` vs `planFeatureMap.avg_creativity`,
   - `grammar_quality`,
   - `singleToneBonus` (ровно один tone onehot равен 1),
   - toneBonus по `slotContext.targetToneIndex`,
   - ctaAlignment по `slotContext.ctaPreference`.

Итог:
- `score = effectivePredictedLikes + alignmentBonus - realism.penalty`

### 13.4. Как вычисляется slotContext для Stage 2

Для каждого slot‑поста:
- `targetToneIndex = resolveToneIndex(publication.tone)`
  - если tone распознаётся как expert/technical => index 0,
  - friendly => 1,
  - official/corporate => 2,
  - inspiring => 3,
  - humorous => 4.
- `ctaPreference = resolveCtaPreference(publication)`
  - objective `convert/retain` => `required`
  - objective `engage/brand_building` => `preferred`
  - иначе => `avoid`

Эти значения затем напрямую влияют на:
- штраф CTA при несоответствии предпочтению,
- bonus при совпадении tone onehot и targetToneIndex.

## 14. Как проверяется согласованность feature space “обучение vs рантайм”

Чтобы новые признаки в GA реально учитывались, важны две согласованности:

1. `feature_names` в метаданных модели должны совпадать по размерности и смыслу с тем, что возвращает feature engineering:
   - для post: `POST_FEATURE_NAMES.length === feature_dim`
   - для content_plan: `PLAN_FEATURE_NAMES.length === feature_dim`
2. При predict внутри `relevancePredictionService.js` используются feature vectors, собранные из:
   - `buildPlanFeatureVector` / `buildPostFeatureVector`
   - с теми же параметрами (duration, expectedPlatforms, targetAudience — там, где это предусмотрено).

Если размерность поменялась и модель старая — есть обработка размерности в python `adapt_feature_dim(...)`.
Тем не менее корректнее всегда переобучать модели при изменении `PLAN_FEATURE_NAMES`/`POST_FEATURE_NAMES`.

