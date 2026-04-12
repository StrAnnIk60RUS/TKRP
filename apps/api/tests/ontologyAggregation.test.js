import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOntologyFromSnapshot,
  mergeOntologyWithTrustedLlmAdditions
} from '../src/modules/precedents/services/ontologyAggregationService.js'
import { buildOntologyLlmEnrichment } from '../src/modules/precedents/services/ontologyLlmEnrichmentService.js'

test('buildOntologyFromSnapshot creates typed entities, triples and hierarchy', () => {
  const snapshot = {
    publications: [
      {
        publication_id: 'pub-1',
        competitor_id: 'demo_sensors_inc',
        competitor_name: 'Sensors Inc.',
        platform: 'linkedin',
        publication_model: {
          publication_id: 'pub-1',
          topic: 'интеллектуальные датчики',
          audience_segments: ['B2B', 'IT-руководители'],
          format: 'text_post',
          objective: 'educate',
          type: 'case_study',
          key_entities: ['датчики', 'внедрение']
        }
      },
      {
        publication_id: 'pub-2',
        competitor_id: 'demo_sensors_inc',
        competitor_name: 'Sensors Inc.',
        platform: 'linkedin',
        publication_model: {
          publication_id: 'pub-2',
          topic: 'умные датчики',
          audience_segments: ['B2B'],
          format: 'text_post',
          objective: 'inform',
          type: 'expert_review',
          key_entities: ['датчики']
        }
      }
    ],
    content_plans: [
      {
        plan_id: 'plan-1',
        competitor_id: 'demo_sensors_inc',
        competitor_name: 'Sensors Inc.',
        platform: 'linkedin',
        ontology_support: {
          classes: ['it_project', 'audience_segment', 'publication_topic', 'case_study'],
          entities: ['интеллектуальные датчики', 'B2B', 'внедрение', 'умные датчики'],
          relations: ['topic->audience', 'format->objective', 'case_study->evidence']
        },
        content_plan_model: {
          audience_segments: ['B2B', 'IT-руководители'],
          publication_schedule: [
            {
              publication_id: 'pub-1',
              topic: 'интеллектуальные датчики',
              format: 'text_post',
              objective: 'educate'
            }
          ]
        }
      }
    ]
  }

  const ontology = buildOntologyFromSnapshot(snapshot)
  const context = ontology.contexts[0]

  assert.equal(ontology.source_summary.contexts_count, 1)
  assert.ok(context.entity_class_links.some((item) => item.class_id === 'audience_segment'))
  assert.ok(
    context.triples.some(
      (item) =>
        item.subject_label === 'интеллектуальные датчики' &&
        item.predicate === 'targets_audience' &&
        item.object_label === 'B2B'
    )
  )
  assert.ok(
    context.hierarchy.some(
      (item) => item.child_label === 'интеллектуальные датчики' && item.parent_label === 'датчики'
    )
  )
  assert.ok(
    ontology.global.relation_templates.some(
      (item) =>
        item.subject_class === 'publication_topic' &&
        item.predicate === 'targets_audience' &&
        item.object_class === 'audience_segment'
    )
  )
})

test('buildOntologyFromSnapshot includes canonical contract metadata', () => {
  const ontology = buildOntologyFromSnapshot({ publications: [], content_plans: [] })
  assert.equal(typeof ontology.schema_version, 'number')
  assert.ok(Array.isArray(ontology.contract.allowed_classes))
  assert.ok(Array.isArray(ontology.contract.allowed_predicates))
})

test('mergeOntologyWithTrustedLlmAdditions applies only high-confidence additions', () => {
  const snapshot = {
    publications: [
      {
        publication_id: 'pub-1',
        competitor_id: 'acme',
        competitor_name: 'ACME',
        platform: 'linkedin',
        publication_model: {
          topic: 'умные датчики',
          audience_segments: ['B2B'],
          format: 'text_post',
          objective: 'educate'
        }
      }
    ],
    content_plans: []
  }
  const base = buildOntologyFromSnapshot(snapshot)
  const llm = {
    mode: 'active',
    by_context: {
      acme_linkedin: {
        synonyms: [
          { canonical_label: 'умные датчики', synonym: 'smart sensors', confidence: 0.91 },
          { canonical_label: 'умные датчики', synonym: 'iot sensors', confidence: 0.5 }
        ],
        relation_templates: [
          {
            subject_class: 'publication_topic',
            predicate: 'targets_audience',
            object_class: 'audience_segment',
            confidence: 0.92,
            source_label: 'llm'
          }
        ],
        entity_normalizations: []
      }
    },
    metrics: {},
    errors: []
  }
  const merged = mergeOntologyWithTrustedLlmAdditions(snapshot, base, llm, { highConfidenceThreshold: 0.85 })
  assert.equal(merged.trusted_llm_additions.enabled, true)
  assert.equal(merged.trusted_llm_additions.synonyms_count, 1)
  assert.ok(merged.global.synonyms.some((item) => item.synonym === 'smart sensors'))
})

test('buildOntologyLlmEnrichment validates mock candidates from env', async () => {
  const prevMode = process.env.ONTOLOGY_LLM_ENRICHMENT_MODE
  const prevMock = process.env.ONTOLOGY_LLM_MOCK_CANDIDATES_JSON
  try {
    process.env.ONTOLOGY_LLM_ENRICHMENT_MODE = 'shadow'
    process.env.ONTOLOGY_LLM_MOCK_CANDIDATES_JSON = JSON.stringify({
      contexts: [
        {
          context_id: 'demo_linkedin',
          synonyms: [{ canonical_label: 'датчики', synonym: 'sensors', confidence: 0.88 }],
          relation_templates: [
            {
              subject_class: 'publication_topic',
              predicate: 'targets_audience',
              object_class: 'audience_segment',
              confidence: 0.9
            },
            {
              subject_class: 'unknown_class',
              predicate: 'invalid_predicate',
              object_class: 'audience_segment',
              confidence: 0.99
            }
          ],
          entity_normalizations: [{ from: 'IoT', to: 'Internet of Things', confidence: 0.9 }]
        }
      ]
    })

    const result = await buildOntologyLlmEnrichment([{ context_id: 'demo_linkedin' }], {})
    assert.equal(result.mode, 'shadow')
    assert.equal(result.by_context.demo_linkedin.relation_templates.length, 1)
    assert.equal(result.by_context.demo_linkedin.synonyms.length, 1)
    assert.equal(result.by_context.demo_linkedin.entity_normalizations.length, 1)
  } finally {
    process.env.ONTOLOGY_LLM_ENRICHMENT_MODE = prevMode
    process.env.ONTOLOGY_LLM_MOCK_CANDIDATES_JSON = prevMock
  }
})
