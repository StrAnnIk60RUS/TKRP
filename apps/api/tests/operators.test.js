import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneJson,
  onePointCrossoverArrays,
  orderCrossover,
  swapMutationPermutation,
  randomReplaceMutation,
  twoPointCrossoverArrays,
  uniformCrossoverArrays,
  inversionMutation
} from '../src/modules/planning/services/evolutionary/operators.js';

test('cloneJson strips __ga_score metadata', () => {
  const src = { value: 5, __ga_score: 123 };
  const cloned = cloneJson(src);
  assert.deepEqual(cloned, { value: 5 });
});

test('onePointCrossoverArrays combines parents by cut point', () => {
  const [a, b] = onePointCrossoverArrays([1, 2, 3, 4], [9, 8, 7, 6], () => 0.49); // cut=2
  assert.deepEqual(a, [1, 2, 7, 6]);
  assert.deepEqual(b, [9, 8, 3, 4]);
});

test('orderCrossover preserves permutation uniqueness and length', () => {
  const p1 = ['A', 'B', 'C', 'D', 'E'];
  const p2 = ['C', 'E', 'A', 'B', 'D'];
  const [c1, c2] = orderCrossover(p1, p2, () => 0.2);
  assert.equal(c1.length, p1.length);
  assert.equal(c2.length, p2.length);
  assert.equal(new Set(c1).size, p1.length);
  assert.equal(new Set(c2).size, p2.length);
  p1.forEach((gene) => assert.ok(c1.includes(gene)));
  p2.forEach((gene) => assert.ok(c2.includes(gene)));
});

test('swapMutationPermutation swaps exactly two positions', () => {
  const src = [1, 2, 3, 4];
  const mutated = swapMutationPermutation(src, () => 0.1);
  assert.equal(mutated.length, src.length);
  assert.deepEqual([...mutated].sort((x, y) => x - y), [1, 2, 3, 4]);
  assert.notDeepEqual(mutated, src);
});

test('randomReplaceMutation changes value within provided domain', () => {
  const src = ['a', 'x', 'z'];
  const domains = [['a', 'b', 'c'], ['x', 'y'], ['z']];
  const mutated = randomReplaceMutation(src, domains, () => 0.5); // index 1, pick y
  assert.equal(mutated[1], 'y');
  assert.equal(mutated[0], 'a');
  assert.equal(mutated[2], 'z');
});

test('twoPointCrossoverArrays splices middle segment', () => {
  const values = [0.1, 0.7];
  let i = 0;
  const rng = () => values[i++ % values.length];
  const [c1, c2] = twoPointCrossoverArrays([1, 2, 3, 4], [9, 8, 7, 6], rng);
  assert.deepEqual(c1, [9, 8, 3, 4]);
  assert.deepEqual(c2, [1, 2, 7, 6]);
});

test('uniformCrossoverArrays picks genes from either parent only', () => {
  const parentA = [{ v: 1 }, { v: 2 }, { v: 3 }];
  const parentB = [{ v: 9 }, { v: 8 }, { v: 7 }];
  const picks = [0.1, 0.9, 0.1];
  let idx = 0;
  const [c1, c2] = uniformCrossoverArrays(parentA, parentB, () => picks[idx++]);
  assert.deepEqual(c1.map((x) => x.v), [1, 8, 3]);
  assert.deepEqual(c2.map((x) => x.v), [9, 2, 7]);
});

test('inversionMutation reverses selected slice', () => {
  const values = [0.2, 0.8];
  let i = 0;
  const mutated = inversionMutation([1, 2, 3, 4, 5], () => values[i++]);
  assert.deepEqual(mutated, [1, 5, 4, 3, 2]);
});
