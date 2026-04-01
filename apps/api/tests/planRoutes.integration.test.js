import http from 'http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPlanRouter } from '../src/modules/planning/routes/planRouterCore.js';

function attachRequestContext(req, res, next) {
  req.requestId = 'test-req';
  next();
}

function buildApp(deps) {
  const app = express();
  app.use(express.json());
  app.use(attachRequestContext);
  app.use('/api/plan', createPlanRouter(deps));
  return app;
}

async function startServer(app) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve({ srv, port: addr.port });
    });
    srv.on('error', reject);
  });
}

async function postJson(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { res, json };
}

test('plan API routes: generate, optimize, snapshots (in-memory deps, no LLM)', async () => {
  const snapshots = new Map();
  const deps = {
    searchPrecedents: async () => [],
    generateDraftPlanBatched: async () => ({
      draft: { draft_content_plan: { plan_id: 'test-plan', publications: [] } },
      usage: null,
      generation_metadata: {}
    }),
    runHierarchicalOptimization: async (body) => {
      const draft = body?.draft_content_plan || body?.draftContentPlan;
      if (!draft || typeof draft !== 'object') {
        throw new Error('Отсутствует draft_content_plan');
      }
      return {
        stage1: { ga: { generations: 1 } },
        stage2: { constraints_check: { valid: true, messages: [] } },
        optimized_content_plan: { plan_id: 'test-plan', publications: [] }
      };
    },
    loadDraft: async () => null,
    saveDraft: async () => true,
    saveSnapshot: async (plan, optimization, token) => {
      const t =
        typeof token === 'string' && /^[a-zA-Z0-9_-]{10,128}$/.test(token)
          ? token
          : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      snapshots.set(t, { plan, optimization });
      return { token: t, saved_at: new Date().toISOString(), summary: { plan_id: plan.plan_id } };
    },
    listSnapshots: async () =>
      [...snapshots.keys()].map((token) => ({
        token,
        saved_at: new Date().toISOString(),
        summary: { plan_id: snapshots.get(token)?.plan?.plan_id }
      })),
    loadSnapshot: async (token) => {
      const row = snapshots.get(token);
      if (!row) return null;
      return {
        token,
        saved_at: new Date().toISOString(),
        plan: row.plan,
        optimization: row.optimization,
        summary: {}
      };
    },
    deleteSnapshot: async (token) => {
      if (!/^[a-zA-Z0-9_-]{10,128}$/.test(token)) return { ok: false, reason: 'invalid_token' };
      snapshots.delete(token);
      return { ok: true };
    }
  };

  const app = buildApp(deps);
  const { srv, port } = await startServer(app);
  try {
    const missingForm = await postJson(port, '/api/plan/generate', {});
    assert.equal(missingForm.res.status, 400);

    const okGen = await postJson(port, '/api/plan/generate', {
      form_input: { projectName: 'Demo' },
      rag_query: 'demo query'
    });
    assert.equal(okGen.res.status, 200);
    assert.equal(okGen.json.success, true);
    assert.ok(okGen.json.draft);

    const badOpt = await postJson(port, '/api/plan/optimize', {});
    assert.equal(badOpt.res.status, 400);

    const okOpt = await postJson(port, '/api/plan/optimize', {
      draft_content_plan: {
        planning_horizon: { duration_days: 7 },
        publications: [{ publication_id: '1' }]
      },
      stage1: { constraints: { duration_days: 7, posts_per_week: 2 } }
    });
    assert.equal(okOpt.res.status, 200);
    assert.equal(okOpt.json.success, true);

    const badSnap = await postJson(port, '/api/plan/snapshots', {});
    assert.equal(badSnap.res.status, 400);

    const okSnap = await postJson(port, '/api/plan/snapshots', {
      plan: { plan_id: 'snap1', publications: [] }
    });
    assert.equal(okSnap.res.status, 200);
    const tok = okSnap.json.snapshot.token;

    const listRes = await fetch(`http://127.0.0.1:${port}/api/plan/snapshots`);
    const listJson = await listRes.json();
    assert.equal(listJson.success, true);
    assert.ok(Array.isArray(listJson.snapshots));

    const oneRes = await fetch(`http://127.0.0.1:${port}/api/plan/snapshots/${tok}`);
    const oneJson = await oneRes.json();
    assert.equal(oneJson.success, true);
    assert.equal(oneJson.snapshot.plan.plan_id, 'snap1');
  } finally {
    srv.close();
  }
});

test('planSnapshotStore: rejects payload over PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES', async () => {
  const prev = process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES;
  process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES = '300';
  const { saveSnapshot } = await import('../src/modules/planning/services/planSnapshotStore.js');
  try {
    await saveSnapshot({
      plan_id: 'huge',
      publications: Array.from({ length: 80 }, () => ({ body: 'x'.repeat(40) }))
    });
    assert.fail('expected PLAN_SNAPSHOT_TOO_LARGE');
  } catch (e) {
    assert.equal(e.code, 'PLAN_SNAPSHOT_TOO_LARGE');
  } finally {
    if (prev === undefined) delete process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES;
    else process.env.PLAN_SNAPSHOT_MAX_PAYLOAD_BYTES = prev;
  }
});

