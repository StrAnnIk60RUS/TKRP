import { normalizeOntologyText } from './metaEntityExtractionService.js';
import {
  ONTOLOGY_ALLOWED_CLASSES,
  ONTOLOGY_ALLOWED_PREDICATES
} from './ontologyAggregationService.js';

const ENRICHMENT_MODES = new Set(['off', 'shadow', 'active']);
const DEFAULT_MODE = 'off';

function asString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value, fallback = 0) {
  return Math.max(0, Math.min(1, asNumber(value, fallback)));
}

function getModeFromEnv() {
  const raw = asString(process.env.ONTOLOGY_LLM_ENRICHMENT_MODE, DEFAULT_MODE).toLowerCase();
  return ENRICHMENT_MODES.has(raw) ? raw : DEFAULT_MODE;
}

function parseJsonEnv(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeLabel(value) {
  const label = asString(value);
  return label.replace(/\s+/g, ' ').trim();
}

function validateCandidateSynonym(item) {
  const canonicalLabel = normalizeLabel(item?.canonical_label);
  const synonym = normalizeLabel(item?.synonym);
  if (!canonicalLabel || !synonym) return null;
  if (normalizeOntologyText(canonicalLabel) === normalizeOntologyText(synonym)) return null;
  return {
    canonical_label: canonicalLabel,
    synonym,
    confidence: clamp01(item?.confidence, 0.5),
    evidence: asString(item?.evidence, '')
  };
}

function validateCandidateTemplate(item) {
  const subjectClass = asString(item?.subject_class).toLowerCase();
  const predicate = asString(item?.predicate).toLowerCase();
  const objectClass = asString(item?.object_class).toLowerCase();
  if (!subjectClass || !predicate || !objectClass) return null;
  if (!ONTOLOGY_ALLOWED_CLASSES.includes(subjectClass)) return null;
  if (!ONTOLOGY_ALLOWED_CLASSES.includes(objectClass)) return null;
  if (!ONTOLOGY_ALLOWED_PREDICATES.includes(predicate)) return null;
  return {
    subject_class: subjectClass,
    predicate,
    object_class: objectClass,
    confidence: clamp01(item?.confidence, 0.5),
    source_label: asString(item?.source_label, 'llm'),
    evidence: asString(item?.evidence, '')
  };
}

function validateCandidateNormalization(item) {
  const from = normalizeLabel(item?.from);
  const to = normalizeLabel(item?.to);
  if (!from || !to) return null;
  if (normalizeOntologyText(from) === normalizeOntologyText(to)) return null;
  return {
    from,
    to,
    confidence: clamp01(item?.confidence, 0.5),
    evidence: asString(item?.evidence, '')
  };
}

function validateCandidates(raw = {}) {
  const synonyms = Array.isArray(raw?.synonyms) ? raw.synonyms : [];
  const relationTemplates = Array.isArray(raw?.relation_templates) ? raw.relation_templates : [];
  const entityNormalizations = Array.isArray(raw?.entity_normalizations) ? raw.entity_normalizations : [];
  const validated = {
    synonyms: [],
    relation_templates: [],
    entity_normalizations: []
  };

  synonyms.forEach((item) => {
    const normalized = validateCandidateSynonym(item);
    if (normalized) validated.synonyms.push(normalized);
  });
  relationTemplates.forEach((item) => {
    const normalized = validateCandidateTemplate(item);
    if (normalized) validated.relation_templates.push(normalized);
  });
  entityNormalizations.forEach((item) => {
    const normalized = validateCandidateNormalization(item);
    if (normalized) validated.entity_normalizations.push(normalized);
  });

  return validated;
}

export function getOntologyLlmEnrichmentConfig() {
  return {
    mode: getModeFromEnv(),
    highConfidenceThreshold: clamp01(process.env.ONTOLOGY_LLM_HIGH_CONFIDENCE_THRESHOLD, 0.85),
    timeoutMs: Math.max(5000, asNumber(process.env.ONTOLOGY_LLM_TIMEOUT_MS, 20000))
  };
}

function getMockCandidatesByContext(contexts = []) {
  const parsed = parseJsonEnv(process.env.ONTOLOGY_LLM_MOCK_CANDIDATES_JSON);
  if (!parsed || typeof parsed !== 'object') return {};
  if (!Array.isArray(parsed?.contexts)) return {};

  const byContext = {};
  parsed.contexts.forEach((item) => {
    const contextId = asString(item?.context_id);
    if (!contextId) return;
    byContext[contextId] = validateCandidates(item);
  });

  const knownIds = new Set(contexts.map((ctx) => ctx.context_id));
  Object.keys(byContext).forEach((contextId) => {
    if (!knownIds.has(contextId)) {
      delete byContext[contextId];
    }
  });
  return byContext;
}

export async function buildOntologyLlmEnrichment(contexts = [], _canonicalOntology = {}) {
  const config = getOntologyLlmEnrichmentConfig();
  const startedAt = Date.now();
  if (config.mode === 'off') {
    return {
      mode: config.mode,
      by_context: {},
      usage: null,
      metrics: {
        candidates_total: 0,
        validated_total: 0,
        rejected_total: 0,
        latency_ms: Date.now() - startedAt
      },
      errors: []
    };
  }

  const byContext = getMockCandidatesByContext(contexts);
  const validatedTotal = Object.values(byContext).reduce(
    (acc, item) =>
      acc +
      (item?.synonyms?.length || 0) +
      (item?.relation_templates?.length || 0) +
      (item?.entity_normalizations?.length || 0),
    0
  );

  return {
    mode: config.mode,
    by_context: byContext,
    usage: null,
    metrics: {
      candidates_total: validatedTotal,
      validated_total: validatedTotal,
      rejected_total: 0,
      latency_ms: Date.now() - startedAt
    },
    errors: []
  };
}
