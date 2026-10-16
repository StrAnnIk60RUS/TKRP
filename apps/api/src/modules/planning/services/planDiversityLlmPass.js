import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callOpenRouterChat, OPENROUTER_API_KEY } from '../../../../openrouter.js';
import { extractJsonObjectFromContent } from '../../enrichment/services/semanticEnrichmentPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(__dirname, '../../shared/prompts/planDiversityTextRewritePrompt.txt');

function readPromptFile() {
  return fs.readFileSync(PROMPT_PATH, 'utf-8');
}

function compactPublicationForRewrite(pub = {}) {
  const km = String(pub.key_message || '').trim();
  const sm = String(pub.summary || '').trim();
  return {
    publication_id: pub.publication_id || null,
    topic: pub.topic || '',
    objective: pub.objective || '',
    format: pub.format || '',
    tone: pub.tone || '',
    key_message: km.length > 400 ? `${km.slice(0, 397)}...` : km,
    summary: sm.length > 1200 ? `${sm.slice(0, 1197)}...` : sm
  };
}

export function mergePublicationsRewrite(originalPubs, llmList) {
  const byId = new Map(
    (Array.isArray(llmList) ? llmList : [])
      .filter((p) => p && p.publication_id)
      .map((p) => [String(p.publication_id), p])
  );
  return originalPubs.map((pub) => {
    const id = String(pub.publication_id || '');
    const rw = byId.get(id);
    if (!rw) return pub;
    const km = typeof rw.key_message === 'string' ? rw.key_message.trim() : '';
    const sm = typeof rw.summary === 'string' ? rw.summary.trim() : '';
    return {
      ...pub,
      ...(km ? { key_message: km } : {}),
      ...(sm ? { summary: sm } : {})
    };
  });
}

/**
 * Пост-обработка LLM включена по умолчанию.
 * Выключается телом stage3.llm_diversity_rewrite === false или PLAN_DIVERSITY_LLM_REWRITE=0|false|off.
 */
export function shouldRunPlanDiversityLlmRewrite(payload = {}, stage3Override = null) {
  const stage3 =
    stage3Override && typeof stage3Override === 'object'
      ? stage3Override
      : payload?.stage3 && typeof payload.stage3 === 'object'
        ? payload.stage3
        : {};
  if (stage3.llm_diversity_rewrite === false) return false;
  if (stage3.llm_diversity_rewrite === true) return true;
  const flag = String(process.env.PLAN_DIVERSITY_LLM_REWRITE || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}

/**
 * Fitness rollback guard: если post-rewrite fitness < pre-rewrite fitness - epsilon,
 * возвращает original publications с meta patch { skipped: true, reason: 'rollback', ... }.
 * @param {Array} originalPubs
 * @param {Array} mergedPubs
 * @param {{ fitnessFn: Function, epsilon?: number }} guard - fitnessFn(pubs) -> number (may be async)
 * @returns {Promise<{ publications: Array, meta: { skipped?: boolean, reason?: string, fitness_before?: number, fitness_after?: number } }>}
 */
export async function applyFitnessRollbackGuard(originalPubs, mergedPubs, guard) {
  const epsilon = Number.isFinite(Number(guard.epsilon)) ? Number(guard.epsilon) : 0;
  const fitnessBefore = await guard.fitnessFn(originalPubs);
  const fitnessAfter = await guard.fitnessFn(mergedPubs);
  if (
    Number.isFinite(Number(fitnessBefore)) &&
    Number.isFinite(Number(fitnessAfter)) &&
    Number(fitnessAfter) < Number(fitnessBefore) - epsilon
  ) {
    return {
      publications: originalPubs,
      meta: {
        skipped: true,
        reason: 'rollback',
        fitness_before: Number(fitnessBefore),
        fitness_after: Number(fitnessAfter)
      }
    };
  }
  return {
    publications: mergedPubs,
    meta: { fitness_before: Number(fitnessBefore), fitness_after: Number(fitnessAfter) }
  };
}

/**
 * Переписывает key_message и summary плана для лексического разнообразия.
 * @param {{ publications?: Array, plan_id?: string }} planSlice
 * @param {{ temperature?: number, fitnessGuard?: { fitnessFn: Function, epsilon?: number } }} options
 *  fitnessGuard — optional rollback guard: fitnessFn(publications) -> number (may be async);
 *  if post-rewrite fitness < pre-rewrite fitness - epsilon, the original publications
 *  are returned with meta.reason = 'rollback' (fitness_before/fitness_after in meta).
 * @returns {Promise<{ publications: Array, meta: object }>}
 */
export async function applyPlanDiversityLlmRewrite(planSlice = {}, options = {}) {
  const publications = Array.isArray(planSlice.publications) ? planSlice.publications : [];
  const meta = {
    skipped: true,
    reason: null,
    usage: null
  };

  if (!publications.length) {
    meta.reason = 'empty_publications';
    return { publications, meta };
  }

  if (!OPENROUTER_API_KEY) {
    meta.reason = 'no_openrouter_key';
    return { publications, meta };
  }

  const systemPrompt = readPromptFile();
  const payloadIn = {
    plan_id: planSlice.plan_id || null,
    content_profile: planSlice.content_profile || null,
    publications: publications.map(compactPublicationForRewrite)
  };

  const userPrompt = `Входной план (JSON). Перепиши key_message и summary по правилам из системного промпта.\n\n${JSON.stringify(payloadIn)}`;

  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.65;

  const llmResponse = await callOpenRouterChat(systemPrompt, userPrompt, {
    temperature,
    responseFormat: 'json'
  });

  let parsed;
  try {
    parsed = extractJsonObjectFromContent(llmResponse.content || '');
  } catch (_e) {
    meta.reason = 'json_parse_error';
    return { publications, meta };
  }
  const list = parsed?.publications;
  if (!Array.isArray(list) || list.length === 0) {
    meta.reason = 'invalid_llm_json';
    return { publications, meta };
  }

  const merged = mergePublicationsRewrite(publications, list);

  const guard = options.fitnessGuard;
  if (guard && typeof guard.fitnessFn === 'function') {
    try {
      const guarded = await applyFitnessRollbackGuard(publications, merged, guard);
      meta.fitness_before = guarded.meta.fitness_before;
      meta.fitness_after = guarded.meta.fitness_after;
      if (guarded.meta.reason === 'rollback') {
        meta.skipped = true;
        meta.reason = 'rollback';
        return { publications: guarded.publications, meta };
      }
    } catch (error) {
      // Если fitness guard сам падрыл — не верт rewrite; log-only (guard не должен блоки pipeline).
      console.warn(`[planDiversityLlmPass] fitness guard error: ${error.message}`);
    }
  }

  meta.skipped = false;
  meta.reason = 'ok';
  meta.usage = llmResponse.usage || null;
  return { publications: merged, meta };
}
