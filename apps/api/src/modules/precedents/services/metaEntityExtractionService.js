const ENTITY_CLASS_AUDIENCE = 'audience_segment';
const ENTITY_CLASS_TOPIC = 'publication_topic';
const ENTITY_CLASS_FORMAT = 'publication_format';
const ENTITY_CLASS_OBJECTIVE = 'publication_objective';
const ENTITY_CLASS_TYPE = 'publication_type';
const ENTITY_CLASS_PROJECT = 'it_project';
const ENTITY_CLASS_EVIDENCE = 'evidence_marker';

const AUDIENCE_HINTS = [
  'b2b',
  'b2c',
  'b2g',
  'разработ',
  'developer',
  'engineer',
  'директор',
  'руковод',
  'cto',
  'cmo',
  'ceo',
  'маркетолог',
  'it-руковод',
  'команда',
  'business',
  'customer',
  'клиент'
];

const EVIDENCE_HINTS = ['кейс', 'внедрение', 'метрики', 'roi', 'доказ', 'лог', 'сравнен', 'review'];

const RELATION_TEMPLATE_PRESETS = {
  'topic->audience': {
    subject_class: ENTITY_CLASS_TOPIC,
    predicate: 'targets_audience',
    object_class: ENTITY_CLASS_AUDIENCE
  },
  'format->objective': {
    subject_class: ENTITY_CLASS_FORMAT,
    predicate: 'supports_objective',
    object_class: ENTITY_CLASS_OBJECTIVE
  },
  'case_study->evidence': {
    subject_class: ENTITY_CLASS_TYPE,
    predicate: 'requires_evidence',
    object_class: ENTITY_CLASS_EVIDENCE
  },
  'format->how_to': {
    subject_class: ENTITY_CLASS_FORMAT,
    predicate: 'supports_publication_type',
    object_class: ENTITY_CLASS_TYPE
  }
};

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeOntologyText(value) {
  if (!isNonEmptyString(value)) return '';
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value, fallback = 'item') {
  const normalized = normalizeOntologyText(value)
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .filter(isNonEmptyString)
        .map((value) => value.trim())
    )
  );
}

function getEntityKey(label, classId) {
  return `${normalizeOntologyText(label)}::${classId}`;
}

function buildEntityId(contextId, label, classId) {
  return `entity_${slugify(contextId)}_${slugify(classId)}_${slugify(label)}`;
}

function buildRelationTemplateId(contextId, subjectClass, predicate, objectClass) {
  return `rt_${slugify(contextId)}_${slugify(subjectClass)}_${slugify(predicate)}_${slugify(objectClass)}`;
}

function buildTripleId(contextId, subjectId, predicate, objectId) {
  return `triple_${slugify(contextId)}_${slugify(subjectId)}_${slugify(predicate)}_${slugify(objectId)}`;
}

function buildHierarchyId(contextId, childId, parentId) {
  return `hier_${slugify(contextId)}_${slugify(childId)}_${slugify(parentId)}`;
}

function pushUniqueById(items, item) {
  if (!item?.id) return;
  if (items.some((existing) => existing.id === item.id)) return;
  items.push(item);
}

function ensureClass(classesMap, classId, label = null) {
  if (!isNonEmptyString(classId)) return null;
  const normalizedId = classId.trim();
  if (!classesMap.has(normalizedId)) {
    classesMap.set(normalizedId, {
      id: normalizedId,
      label: label || normalizedId,
      source_count: 0
    });
  }
  const existing = classesMap.get(normalizedId);
  existing.source_count += 1;
  return existing.id;
}

function classifyLooseEntity(label, knownAudienceLabels, knownTopicLabels, availableClasses) {
  const normalized = normalizeOntologyText(label);
  if (!normalized) return ENTITY_CLASS_TOPIC;

  if (knownAudienceLabels.has(normalized)) return ENTITY_CLASS_AUDIENCE;
  if (knownTopicLabels.has(normalized)) return ENTITY_CLASS_TOPIC;

  if (AUDIENCE_HINTS.some((hint) => normalized.includes(hint))) return ENTITY_CLASS_AUDIENCE;
  if (EVIDENCE_HINTS.some((hint) => normalized.includes(hint))) return ENTITY_CLASS_EVIDENCE;

  if (availableClasses.has(ENTITY_CLASS_PROJECT) && /(platform|cloud|облако|iot|saas|crm|erp)/.test(normalized)) {
    return ENTITY_CLASS_PROJECT;
  }

  return ENTITY_CLASS_TOPIC;
}

function parseRelationTemplate(relationRaw, contextId) {
  const normalized = isNonEmptyString(relationRaw)
    ? relationRaw
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9_\-\u0400-\u04ff>]/gi, '')
    : '';
  if (!normalized) return null;

  const preset = RELATION_TEMPLATE_PRESETS[normalized];
  if (preset) {
    return {
      id: buildRelationTemplateId(contextId, preset.subject_class, preset.predicate, preset.object_class),
      source_label: relationRaw,
      ...preset
    };
  }

  const [left, right] = normalized.split('->');
  if (!left || !right) return null;

  const subjectClass = left.includes('audience')
    ? ENTITY_CLASS_AUDIENCE
    : left.includes('format')
      ? ENTITY_CLASS_FORMAT
      : left.includes('objective')
        ? ENTITY_CLASS_OBJECTIVE
        : left.includes('case') || left.includes('how')
          ? ENTITY_CLASS_TYPE
          : ENTITY_CLASS_TOPIC;

  const objectClass = right.includes('audience')
    ? ENTITY_CLASS_AUDIENCE
    : right.includes('format')
      ? ENTITY_CLASS_FORMAT
      : right.includes('objective')
        ? ENTITY_CLASS_OBJECTIVE
        : right.includes('evidence')
          ? ENTITY_CLASS_EVIDENCE
          : right.includes('case') || right.includes('how')
            ? ENTITY_CLASS_TYPE
            : ENTITY_CLASS_TOPIC;

  return {
    id: buildRelationTemplateId(contextId, subjectClass, `relates_to_${objectClass}`, objectClass),
    source_label: relationRaw,
    subject_class: subjectClass,
    predicate: `relates_to_${objectClass}`,
    object_class: objectClass
  };
}

export function extractMetaEntitiesForContext(input = {}) {
  const competitorId = input.competitor_id || 'unknown_competitor';
  const competitorName = input.competitor_name || competitorId;
  const platform = input.platform || 'unknown';
  const contextId = input.context_id || `${competitorId}_${platform}`;
  const publications = Array.isArray(input.publications) ? input.publications : [];
  const contentPlans = Array.isArray(input.content_plans) ? input.content_plans : [];
  const ontologySupports = Array.isArray(input.ontology_supports) ? input.ontology_supports.filter(Boolean) : [];

  const classesMap = new Map();
  const entitiesMap = new Map();
  const entityClassLinks = [];
  const relationTemplates = [];
  const triples = [];
  const hierarchy = [];
  const synonyms = [];

  const topicLabels = new Set();
  const audienceLabels = new Set();

  const addClass = (classId, label = null) => ensureClass(classesMap, classId, label);

  const addEntity = (label, classId, meta = {}) => {
    if (!isNonEmptyString(label) || !isNonEmptyString(classId)) return null;
    const finalClassId = addClass(classId);
    const key = getEntityKey(label, finalClassId);
    if (!entitiesMap.has(key)) {
      entitiesMap.set(key, {
        id: buildEntityId(contextId, label, finalClassId),
        label: label.trim(),
        normalized_label: normalizeOntologyText(label),
        class_id: finalClassId,
        context_id: contextId,
        competitor_id: competitorId,
        competitor_name: competitorName,
        platform,
        source_types: []
      });
    }

    const entity = entitiesMap.get(key);
    if (isNonEmptyString(meta.source_type) && !entity.source_types.includes(meta.source_type.trim())) {
      entity.source_types.push(meta.source_type.trim());
    }

    if (finalClassId === ENTITY_CLASS_TOPIC) topicLabels.add(entity.normalized_label);
    if (finalClassId === ENTITY_CLASS_AUDIENCE) audienceLabels.add(entity.normalized_label);

    const linkId = `ecl_${slugify(contextId)}_${slugify(entity.id)}_${slugify(finalClassId)}`;
    if (!entityClassLinks.some((item) => item.id === linkId)) {
      entityClassLinks.push({
        id: linkId,
        entity_id: entity.id,
        class_id: finalClassId,
        confidence: Number(meta.confidence ?? 0.9),
        source_type: meta.source_type || 'derived'
      });
    }

    return entity;
  };

  const addTriple = (subjectEntity, predicate, objectEntity, meta = {}) => {
    if (!subjectEntity?.id || !isNonEmptyString(predicate) || !objectEntity?.id) return;
    const triple = {
      id: buildTripleId(contextId, subjectEntity.id, predicate, objectEntity.id),
      context_id: contextId,
      competitor_id: competitorId,
      competitor_name: competitorName,
      platform,
      subject_id: subjectEntity.id,
      subject_label: subjectEntity.label,
      predicate: predicate.trim(),
      object_id: objectEntity.id,
      object_label: objectEntity.label,
      evidence: meta.evidence || null,
      source_publication_id: meta.source_publication_id || null,
      source_plan_id: meta.source_plan_id || null
    };
    pushUniqueById(triples, triple);
  };

  ontologySupports.forEach((support) => {
    uniqueStrings(support?.classes || []).forEach((classId) => addClass(classId));
  });

  publications.forEach((publication) => {
    const model = publication?.publication_model || {};
    const topic = addEntity(model.topic, ENTITY_CLASS_TOPIC, {
      source_type: 'publication_topic',
      confidence: 0.98
    });
    const format = addEntity(model.format, ENTITY_CLASS_FORMAT, {
      source_type: 'publication_format',
      confidence: 0.97
    });
    const objective = addEntity(model.objective, ENTITY_CLASS_OBJECTIVE, {
      source_type: 'publication_objective',
      confidence: 0.97
    });
    const type = addEntity(model.type, ENTITY_CLASS_TYPE, {
      source_type: 'publication_type',
      confidence: 0.97
    });

    uniqueStrings(model.audience_segments || []).forEach((label) => {
      const audience = addEntity(label, ENTITY_CLASS_AUDIENCE, {
        source_type: 'audience_segment',
        confidence: 0.99
      });
      addTriple(topic, 'targets_audience', audience, {
        source_publication_id: publication.publication_id,
        evidence: `publication:${publication.publication_id || 'unknown'}`
      });
    });

    uniqueStrings(model.key_entities || []).forEach((label) => {
      const keyEntity = addEntity(label, ENTITY_CLASS_TOPIC, {
        source_type: 'key_entity',
        confidence: 0.82
      });
      if (topic && keyEntity && topic.id !== keyEntity.id) {
        addTriple(keyEntity, 'mentioned_in_topic', topic, {
          source_publication_id: publication.publication_id,
          evidence: `publication:${publication.publication_id || 'unknown'}`
        });
      }
    });

    addTriple(format, 'supports_objective', objective, {
      source_publication_id: publication.publication_id,
      evidence: `publication:${publication.publication_id || 'unknown'}`
    });
    addTriple(type, 'supports_objective', objective, {
      source_publication_id: publication.publication_id,
      evidence: `publication:${publication.publication_id || 'unknown'}`
    });
  });

  contentPlans.forEach((contentPlan) => {
    const model = contentPlan?.content_plan_model || {};
    uniqueStrings(model.audience_segments || []).forEach((label) => {
      addEntity(label, ENTITY_CLASS_AUDIENCE, {
        source_type: 'plan_audience_segment',
        confidence: 0.96
      });
    });

    const schedule = Array.isArray(model.publication_schedule) ? model.publication_schedule : [];
    schedule.forEach((item) => {
      const topic = addEntity(item?.topic, ENTITY_CLASS_TOPIC, {
        source_type: 'plan_topic',
        confidence: 0.9
      });
      const format = addEntity(item?.format, ENTITY_CLASS_FORMAT, {
        source_type: 'plan_format',
        confidence: 0.9
      });
      const objective = addEntity(item?.objective, ENTITY_CLASS_OBJECTIVE, {
        source_type: 'plan_objective',
        confidence: 0.9
      });

      addTriple(format, 'supports_objective', objective, {
        source_plan_id: contentPlan.plan_id,
        evidence: `plan:${contentPlan.plan_id || 'unknown'}`
      });

      uniqueStrings(model.audience_segments || []).forEach((label) => {
        const audience = addEntity(label, ENTITY_CLASS_AUDIENCE, {
          source_type: 'plan_audience_segment',
          confidence: 0.96
        });
        addTriple(topic, 'targets_audience', audience, {
          source_plan_id: contentPlan.plan_id,
          evidence: `plan:${contentPlan.plan_id || 'unknown'}`
        });
      });
    });
  });

  const availableClasses = new Set(Array.from(classesMap.keys()));
  ontologySupports.forEach((support) => {
    uniqueStrings(support?.entities || []).forEach((label) => {
      const classId = classifyLooseEntity(label, audienceLabels, topicLabels, availableClasses);
      addEntity(label, classId, {
        source_type: 'ontology_support_entity',
        confidence: 0.72
      });
    });

    uniqueStrings(support?.relations || [])
      .map((relationRaw) => parseRelationTemplate(relationRaw, contextId))
      .filter(Boolean)
      .forEach((template) => {
        addClass(template.subject_class);
        addClass(template.object_class);
        pushUniqueById(relationTemplates, template);
      });
  });

  if (!relationTemplates.length) {
    [
      parseRelationTemplate('topic->audience', contextId),
      parseRelationTemplate('format->objective', contextId)
    ]
      .filter(Boolean)
      .forEach((template) => {
        addClass(template.subject_class);
        addClass(template.object_class);
        pushUniqueById(relationTemplates, template);
      });
  }

  const entities = Array.from(entitiesMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const entitiesByClass = entities.reduce((acc, entity) => {
    const key = entity.class_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(entity);
    return acc;
  }, {});

  Object.values(entitiesByClass).forEach((group) => {
    const byHeadToken = new Map();
    group.forEach((entity) => {
      const tokens = entity.normalized_label.split(' ').filter(Boolean);
      const head = tokens[tokens.length - 1] || entity.normalized_label;
      if (!byHeadToken.has(head)) byHeadToken.set(head, []);
      byHeadToken.get(head).push({ entity, tokens });
    });

    byHeadToken.forEach((items) => {
      const sorted = items.sort((a, b) => a.tokens.length - b.tokens.length);
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const broader = sorted[i];
          const narrower = sorted[j];
          const broaderText = broader.tokens.join(' ');
          const narrowerText = narrower.tokens.join(' ');
          if (!broaderText || !narrowerText) continue;
          if (!narrowerText.endsWith(broaderText)) continue;

          pushUniqueById(hierarchy, {
            id: buildHierarchyId(contextId, narrower.entity.id, broader.entity.id),
            child_id: narrower.entity.id,
            child_label: narrower.entity.label,
            parent_id: broader.entity.id,
            parent_label: broader.entity.label,
            predicate: 'narrower_than'
          });
        }
      }

    });
  });

  const classes = Array.from(classesMap.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));

  return {
    context_id: contextId,
    competitor_id: competitorId,
    competitor_name: competitorName,
    platform,
    source_summary: {
      publications_count: publications.length,
      content_plans_count: contentPlans.length,
      ontology_support_count: ontologySupports.length
    },
    classes,
    entities,
    entity_class_links: entityClassLinks,
    relation_templates: relationTemplates,
    triples,
    hierarchy,
    synonyms
  };
}
