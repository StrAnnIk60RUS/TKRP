import { extractMetaEntitiesForContext, normalizeOntologyText } from './metaEntityExtractionService.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function slugify(value, fallback = 'item') {
  const normalized = normalizeOntologyText(value)
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function pushUniqueById(items, item) {
  if (!item?.id) return;
  if (items.some((existing) => existing.id === item.id)) return;
  items.push(item);
}

function groupSnapshotByContext(snapshot = {}) {
  const groups = new Map();
  const publications = Array.isArray(snapshot?.publications) ? snapshot.publications : [];
  const contentPlans = Array.isArray(snapshot?.content_plans) ? snapshot.content_plans : [];

  const ensureGroup = (item = {}, type) => {
    const competitorId = item?.competitor_id || item?.competitor_name || 'unknown_competitor';
    const competitorName = item?.competitor_name || item?.competitor_id || 'Unknown competitor';
    const platform = item?.platform || 'unknown';
    const contextId = `${competitorId}_${platform}`;

    if (!groups.has(contextId)) {
      groups.set(contextId, {
        context_id: contextId,
        competitor_id: competitorId,
        competitor_name: competitorName,
        platform,
        publications: [],
        content_plans: [],
        ontology_supports: []
      });
    }

    const group = groups.get(contextId);
    if (type === 'publication') group.publications.push(item);
    if (type === 'content_plan') {
      group.content_plans.push(item);
      if (item?.ontology_support) {
        group.ontology_supports.push(item.ontology_support);
      }
    }
  };

  publications.forEach((item) => ensureGroup(item, 'publication'));
  contentPlans.forEach((item) => ensureGroup(item, 'content_plan'));

  return Array.from(groups.values());
}

function aggregateGlobalClasses(contexts = []) {
  const byId = new Map();
  contexts.forEach((context) => {
    (context?.classes || []).forEach((cls) => {
      const existing = byId.get(cls.id) || {
        id: cls.id,
        label: cls.label || cls.id,
        context_ids: []
      };
      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      byId.set(cls.id, existing);
    });
  });
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function aggregateGlobalEntities(contexts = []) {
  const byKey = new Map();
  contexts.forEach((context) => {
    (context?.entities || []).forEach((entity) => {
      const key = `${normalizeOntologyText(entity.label)}::${entity.class_id}`;
      const existing = byKey.get(key) || {
        id: `global_${slugify(entity.class_id)}_${slugify(entity.label)}`,
        label: entity.label,
        normalized_label: normalizeOntologyText(entity.label),
        class_id: entity.class_id,
        context_ids: [],
        competitor_names: [],
        platforms: [],
        source_types: []
      };

      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      if (isNonEmptyString(context.competitor_name) && !existing.competitor_names.includes(context.competitor_name)) {
        existing.competitor_names.push(context.competitor_name);
      }
      if (isNonEmptyString(context.platform) && !existing.platforms.includes(context.platform)) {
        existing.platforms.push(context.platform);
      }
      (entity.source_types || []).forEach((sourceType) => {
        if (isNonEmptyString(sourceType) && !existing.source_types.includes(sourceType)) {
          existing.source_types.push(sourceType);
        }
      });

      byKey.set(key, existing);
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

function aggregateGlobalEntityClassLinks(globalEntities = []) {
  return globalEntities.map((entity) => ({
    id: `global_ecl_${slugify(entity.id)}_${slugify(entity.class_id)}`,
    entity_id: entity.id,
    class_id: entity.class_id,
    confidence: 0.95,
    contexts_count: entity.context_ids.length
  }));
}

function aggregateGlobalRelationTemplates(contexts = []) {
  const byKey = new Map();
  contexts.forEach((context) => {
    (context?.relation_templates || []).forEach((template) => {
      const key = `${template.subject_class}::${template.predicate}::${template.object_class}`;
      const existing = byKey.get(key) || {
        id: `global_rt_${slugify(template.subject_class)}_${slugify(template.predicate)}_${slugify(template.object_class)}`,
        subject_class: template.subject_class,
        predicate: template.predicate,
        object_class: template.object_class,
        source_labels: [],
        context_ids: []
      };
      if (isNonEmptyString(template.source_label) && !existing.source_labels.includes(template.source_label)) {
        existing.source_labels.push(template.source_label);
      }
      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      byKey.set(key, existing);
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function aggregateGlobalTriples(contexts = []) {
  const byKey = new Map();
  contexts.forEach((context) => {
    (context?.triples || []).forEach((triple) => {
      const key = `${normalizeOntologyText(triple.subject_label)}::${triple.predicate}::${normalizeOntologyText(triple.object_label)}`;
      const existing = byKey.get(key) || {
        id: `global_triple_${slugify(triple.subject_label)}_${slugify(triple.predicate)}_${slugify(triple.object_label)}`,
        subject_label: triple.subject_label,
        predicate: triple.predicate,
        object_label: triple.object_label,
        context_ids: [],
        evidences: []
      };
      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      if (isNonEmptyString(triple.evidence) && !existing.evidences.includes(triple.evidence)) {
        existing.evidences.push(triple.evidence);
      }
      byKey.set(key, existing);
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function aggregateGlobalHierarchy(contexts = []) {
  const byKey = new Map();
  contexts.forEach((context) => {
    (context?.hierarchy || []).forEach((relation) => {
      const key = `${normalizeOntologyText(relation.child_label)}::${relation.predicate}::${normalizeOntologyText(relation.parent_label)}`;
      const existing = byKey.get(key) || {
        id: `global_hier_${slugify(relation.child_label)}_${slugify(relation.parent_label)}`,
        child_label: relation.child_label,
        parent_label: relation.parent_label,
        predicate: relation.predicate,
        context_ids: []
      };
      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      byKey.set(key, existing);
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function aggregateGlobalSynonyms(contexts = []) {
  const byKey = new Map();
  contexts.forEach((context) => {
    (context?.synonyms || []).forEach((synonym) => {
      const key = `${normalizeOntologyText(synonym.canonical_label)}::${normalizeOntologyText(synonym.synonym)}`;
      const existing = byKey.get(key) || {
        id: `global_syn_${slugify(synonym.canonical_label)}_${slugify(synonym.synonym)}`,
        canonical_label: synonym.canonical_label,
        synonym: synonym.synonym,
        context_ids: []
      };
      if (!existing.context_ids.includes(context.context_id)) {
        existing.context_ids.push(context.context_id);
      }
      byKey.set(key, existing);
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function aggregateMetaEntities(globalEntities = []) {
  return globalEntities.map((entity) => ({
    id: `meta_${slugify(entity.class_id)}_${slugify(entity.label)}`,
    label: entity.label,
    class_id: entity.class_id,
    frequency: entity.context_ids.length,
    competitor_names: entity.competitor_names,
    platforms: entity.platforms
  }));
}

export function buildOntologyFromSnapshot(snapshot = {}) {
  const groupedContexts = groupSnapshotByContext(snapshot);
  const contexts = groupedContexts.map((group) => extractMetaEntitiesForContext(group));

  const globalClasses = aggregateGlobalClasses(contexts);
  const globalEntities = aggregateGlobalEntities(contexts);
  const globalEntityClassLinks = aggregateGlobalEntityClassLinks(globalEntities);
  const globalRelationTemplates = aggregateGlobalRelationTemplates(contexts);
  const globalTriples = aggregateGlobalTriples(contexts);
  const globalHierarchy = aggregateGlobalHierarchy(contexts);
  const globalSynonyms = aggregateGlobalSynonyms(contexts);
  const metaEntities = aggregateMetaEntities(globalEntities);

  return {
    generated_at: new Date().toISOString(),
    source_summary: {
      contexts_count: contexts.length,
      publications_count: Array.isArray(snapshot?.publications) ? snapshot.publications.length : 0,
      content_plans_count: Array.isArray(snapshot?.content_plans) ? snapshot.content_plans.length : 0
    },
    contexts,
    global: {
      classes: globalClasses,
      entities: globalEntities,
      entity_class_links: globalEntityClassLinks,
      relation_templates: globalRelationTemplates,
      triples: globalTriples,
      hierarchy: globalHierarchy,
      synonyms: globalSynonyms,
      meta_entities: metaEntities
    }
  };
}

export function buildOntologyExportSheets(ontology = {}) {
  const contexts = Array.isArray(ontology?.contexts) ? ontology.contexts : [];
  const global = ontology?.global || {};

  const classesRows = [['Конкурент', 'Платформа', 'Класс']];
  const entitiesRows = [['Конкурент', 'Платформа', 'Сущность', 'Класс']];
  const relationsRows = [['Конкурент', 'Платформа', 'Субъект', 'Предикат', 'Объект', 'Источник']];
  const entityClassRows = [['Конкурент', 'Платформа', 'Сущность', 'Класс', 'Confidence']];
  const templatesRows = [['Конкурент', 'Платформа', 'Subject class', 'Predicate', 'Object class', 'Source label']];
  const hierarchyRows = [['Конкурент', 'Платформа', 'Дочерняя сущность', 'Отношение', 'Родительская сущность']];
  const synonymsRows = [['Конкурент', 'Платформа', 'Каноническая сущность', 'Синоним/вариант']];
  const metaEntitiesRows = [['Сущность', 'Класс', 'Частота', 'Контексты', 'Платформы']];

  contexts.forEach((context) => {
    const competitor = context.competitor_name || context.competitor_id || '—';
    const platform = context.platform || '—';

    (context.classes || []).forEach((cls) => classesRows.push([competitor, platform, cls.id]));
    (context.entities || []).forEach((entity) =>
      entitiesRows.push([competitor, platform, entity.label, entity.class_id])
    );
    (context.entity_class_links || []).forEach((link) => {
      const entity = (context.entities || []).find((item) => item.id === link.entity_id);
      entityClassRows.push([competitor, platform, entity?.label || link.entity_id, link.class_id, link.confidence]);
    });
    (context.relation_templates || []).forEach((template) =>
      templatesRows.push([
        competitor,
        platform,
        template.subject_class,
        template.predicate,
        template.object_class,
        template.source_label || ''
      ])
    );
    (context.triples || []).forEach((triple) =>
      relationsRows.push([
        competitor,
        platform,
        triple.subject_label,
        triple.predicate,
        triple.object_label,
        triple.evidence || ''
      ])
    );
    (context.hierarchy || []).forEach((item) =>
      hierarchyRows.push([competitor, platform, item.child_label, item.predicate, item.parent_label])
    );
    (context.synonyms || []).forEach((item) =>
      synonymsRows.push([competitor, platform, item.canonical_label, item.synonym])
    );
  });

  (global.meta_entities || []).forEach((item) => {
    metaEntitiesRows.push([
      item.label,
      item.class_id,
      item.frequency,
      Array.isArray(item.competitor_names) ? item.competitor_names.join(', ') : '',
      Array.isArray(item.platforms) ? item.platforms.join(', ') : ''
    ]);
  });

  return {
    classesRows,
    entitiesRows,
    relationsRows,
    entityClassRows,
    templatesRows,
    hierarchyRows,
    synonymsRows,
    metaEntitiesRows
  };
}

function escapeTurtleLiteral(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

export function serializeOntologyToTurtle(ontology = {}) {
  const global = ontology?.global || {};
  const classes = Array.isArray(global.classes) ? global.classes : [];
  const entities = Array.isArray(global.entities) ? global.entities : [];
  const triples = Array.isArray(global.triples) ? global.triples : [];
  const hierarchy = Array.isArray(global.hierarchy) ? global.hierarchy : [];
  const synonyms = Array.isArray(global.synonyms) ? global.synonyms : [];
  const templates = Array.isArray(global.relation_templates) ? global.relation_templates : [];

  const classLines = classes.map(
    (cls) => `ex:${slugify(cls.id)} a rdfs:Class ; rdfs:label "${escapeTurtleLiteral(cls.label || cls.id)}" .`
  );

  const propertyIds = new Set(triples.map((triple) => triple.predicate).concat(templates.map((item) => item.predicate)));
  const propertyLines = Array.from(propertyIds).map(
    (predicate) => `ex:${slugify(predicate)} a rdf:Property ; rdfs:label "${escapeTurtleLiteral(predicate)}" .`
  );

  const entityUriByKey = new Map();
  const entityLines = entities.map((entity) => {
    const uri = `ex:${slugify(entity.class_id)}_${slugify(entity.label)}`;
    entityUriByKey.set(`${normalizeOntologyText(entity.label)}::${entity.class_id}`, uri);
    return `${uri} a ex:${slugify(entity.class_id)} ; rdfs:label "${escapeTurtleLiteral(entity.label)}" .`;
  });

  const fallbackUriForEntity = (label) => `ex:resource_${slugify(label)}`;
  const findUri = (label, preferredClass = null) => {
    if (preferredClass) {
      const key = `${normalizeOntologyText(label)}::${preferredClass}`;
      if (entityUriByKey.has(key)) return entityUriByKey.get(key);
    }
    const firstMatch = Array.from(entityUriByKey.entries()).find(([key]) =>
      key.startsWith(`${normalizeOntologyText(label)}::`)
    );
    return firstMatch ? firstMatch[1] : fallbackUriForEntity(label);
  };

  const tripleLines = triples.map((triple) => {
    const subjectUri = findUri(triple.subject_label);
    const objectUri = findUri(triple.object_label);
    return `${subjectUri} ex:${slugify(triple.predicate)} ${objectUri} .`;
  });

  const hierarchyLines = hierarchy.map((item) => {
    const childUri = findUri(item.child_label);
    const parentUri = findUri(item.parent_label);
    return `${childUri} ex:${slugify(item.predicate)} ${parentUri} .`;
  });

  const synonymLines = synonyms.map((item) => {
    const entityUri = findUri(item.canonical_label);
    return `${entityUri} ex:hasSynonym "${escapeTurtleLiteral(item.synonym)}" .`;
  });

  const templateLines = templates.map((template) => {
    const templateUri = `ex:template_${slugify(template.subject_class)}_${slugify(template.predicate)}_${slugify(template.object_class)}`;
    return `${templateUri} a ex:RelationTemplate ; ex:subjectClass ex:${slugify(template.subject_class)} ; ex:predicate ex:${slugify(template.predicate)} ; ex:objectClass ex:${slugify(template.object_class)} .`;
  });

  return [
    '@prefix ex: <https://tkrp.local/ontology#> .',
    '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '',
    ...classLines,
    '',
    ...propertyLines,
    '',
    ...entityLines,
    '',
    ...templateLines,
    '',
    ...tripleLines,
    '',
    ...hierarchyLines,
    '',
    ...synonymLines,
    ''
  ].join('\n');
}
