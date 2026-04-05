import test from 'node:test'
import assert from 'node:assert/strict'

import { buildOntologyFromSnapshot } from '../src/modules/precedents/services/ontologyAggregationService.js'

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

