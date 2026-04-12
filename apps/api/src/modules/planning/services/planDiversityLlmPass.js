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

function mergePublicationsRewrite(originalPubs, llmList) {
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
 * Включить пост-обработку LLM: body.stage3.llm_diversity_rewrite === true или PLAN_DIVERSITY_LLM_REWRITE=1
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
  return String(process.env.PLAN_DIVERSITY_LLM_REWRITE || '').trim() === '1';
}

/**
 * Переписывает key_message и summary плана для лексического разнообразия.
 * @param {{ publications?: Array, plan_id?: string }} planSlice
 * @param {{ temperature?: number }} options
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

  const temperature = Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.35;

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
  meta.skipped = false;
  meta.reason = 'ok';
  meta.usage = llmResponse.usage || null;
  return { publications: merged, meta };
}
