import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBm25Corpus,
  reciprocalRankFusion,
  scoreRetrievalHit,
  tokenize,
  uniqueTokens
} from '../src/modules/precedents/repositories/precedentRepositoryShared.js';

test('calculateBm25Corpus scores documents with term frequency, IDF and length normalization', () => {
  const queryTokens = uniqueTokens(tokenize('kubernetes devsecops'));
  const docs = [
    {
      id: 'doc1',
      text: 'Внедрение DevSecOps в кластер Kubernetes для ускорения релизов и безопасности',
      key_entities: ['Kubernetes', 'DevSecOps']
    },
    {
      id: 'doc2',
      text: 'Общие рекомендации по информационной безопасности веб-приложений и базам данных',
      key_entities: ['безопасность']
    },
    {
      id: 'doc3',
      text: 'Руководство по Kubernetes для начинающих: настройка подов и сервисов в облаке',
      key_entities: ['Kubernetes']
    }
  ];

  const results = calculateBm25Corpus(queryTokens, docs, {
    getText: (d) => d.text,
    extractKeyEntities: (d) => d.key_entities,
    boostExactPhrase: 'kubernetes devsecops'
  });

  assert.equal(results.length, 3);
  // doc1 has both query tokens and both in key_entities, so it should rank #1
  assert.equal(results[0].document.id, 'doc1');
  assert.ok(results[0].bm25_score > results[1].bm25_score);
  assert.ok(results[0].bm25_score > results[2].bm25_score);
  assert.equal(results[1].bm25_score, 0); // doc2 has 0 matches for kubernetes/devsecops
  assert.ok(results[0].matched_tokens.includes('kubernetes'));
  assert.ok(results[0].matched_tokens.includes('devsecops'));
});

test('calculateBm25Corpus boosts key domain entities like 1C or Kubernetes over common text', () => {
  const queryTokens = uniqueTokens(tokenize('1c erp'));
  const docs = [
    {
      id: 'short_generic',
      text: 'Автоматизация учета на базе типовых решений',
      key_entities: []
    },
    {
      id: 'exact_domain',
      text: 'Кейс миграции на 1C ERP крупного производственного холдинга',
      key_entities: ['1C ERP', '1C']
    }
  ];

  const results = calculateBm25Corpus(queryTokens, docs, {
    getText: (d) => d.text,
    extractKeyEntities: (d) => d.key_entities
  });

  assert.equal(results[1].document.id, 'exact_domain');
  assert.ok(results[1].bm25_score > 0);
  assert.equal(results[0].bm25_score, 0);
});

test('calculateBm25Corpus handles empty or unmatched inputs gracefully', () => {
  const emptyDocs = calculateBm25Corpus(['test'], []);
  assert.deepEqual(emptyDocs, []);

  const emptyTokens = calculateBm25Corpus([], [{ text: 'some text' }]);
  assert.equal(emptyTokens[0].bm25_score, 0);
});

test('reciprocalRankFusion blends dense vector and sparse lexical ranks using reciprocal rank fusion', () => {
  const docA = { id: 'A', title: 'Kubernetes CI/CD' };
  const docB = { id: 'B', title: 'DevSecOps Automation' };
  const docC = { id: 'C', title: 'Cloud Infrastructure' };

  // Vector run: A is #1, C is #2, B is #3
  // BM25 run: B is #1, A is #2, C is #3
  const runs = [
    {
      name: 'vector',
      rankedItems: [docA, docC, docB],
      weight: 0.6,
      getId: (d) => d.id
    },
    {
      name: 'bm25',
      rankedItems: [docB, docA, docC],
      weight: 0.4,
      getId: (d) => d.id
    }
  ];

  const fused = reciprocalRankFusion(runs, { k: 60 });
  assert.equal(fused.length, 3);

  // docA is rank 1 in vector (weight 0.6) and rank 2 in bm25 (weight 0.4):
  // score = 0.6/(60+1) + 0.4/(60+2) = 0.6/61 + 0.4/62 = 0.009836 + 0.006451 = 0.016287
  // docB is rank 3 in vector (weight 0.6) and rank 1 in bm25 (weight 0.4):
  // score = 0.6/63 + 0.4/61 = 0.009523 + 0.006557 = 0.016080
  // docA should rank 1st because of higher vector weight and good balance
  assert.equal(fused[0].item.id, 'A');
  assert.equal(fused[1].item.id, 'B');
  assert.equal(fused[2].item.id, 'C');

  assert.ok(fused[0].normalized_score > 0);
  assert.ok(fused[0].normalized_score <= 1.0);
  assert.equal(fused[0].ranks.vector, 1);
  assert.equal(fused[0].ranks.bm25, 2);
});

test('scoreRetrievalHit integrates rrfScore with trust and engagement rank signals', () => {
  const hit = scoreRetrievalHit({
    embeddingScore: 0.8,
    tokenScore: 0.7,
    engagementSignal: 0.9,
    trustSignal: 0.85,
    rrfScore: 0.88
  });
  assert.ok(hit >= 0.88);
  assert.ok(hit <= 1.0);

  // Fallback without rrfScore uses embedding + token weights
  const legacyHit = scoreRetrievalHit({
    embeddingScore: 0.8,
    tokenScore: 0.5,
    engagementSignal: 0.5,
    trustSignal: 0.5
  });
  assert.ok(legacyHit > 0);
  assert.ok(legacyHit <= 1.0);
});
