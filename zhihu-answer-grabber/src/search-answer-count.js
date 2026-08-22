// SPDX-License-Identifier: AGPL-3.0-only
/**
 * T2 — search candidate answer-count enrichment（OPEN-D1 批准合同：
 * APPROVED_BOUNDED_QUESTION_INFO_ENRICHMENT）。
 *
 * 合同要点（V0.3 Spec §16 OPEN-D1 / Issue #8）：
 *  - 仅 enrichment 最终 search candidates（被 dedupe/slice 丢弃的 Item 不发请求）；
 *  - 每候选至多 1 次真实 HTTP 尝试（retries: 0，防 requestJson 默认重试暗中突破预算）；
 *  - MAX_EXTRA_REQUESTS_PER_SEARCH = 候选数（当前 candidate cap = 10 → ≤10）；
 *  - Cookie 不可用 → 整体降级为 answerCount: null，不使 search 失败；
 *  - 单候选 enrichment 失败 → 该候选 answerCount: null，search 继续成功；
 *  - answerCount 是 upstream scale metadata，不是 verified claim / capture completeness proof。
 */
import { buildQuestionInfoUrl, humanDelay, requestJson } from './http.js';
import { loadConfig } from './config.js';

/**
 * 对最终 candidates 逐个做 question-info enrichment。
 *
 * @param {Array<{questionId: string, url?: string}>} candidates 最终候选（顺序即输出顺序）
 * @param {object} config Cookie 配置（loadConfig() 产物）
 * @param {{delay?: (() => Promise<void>)}} [options] 注入 delay 以便测试（默认 humanDelay）
 * @returns {Promise<Array<{questionId: string, answerCount: number|null} & object>>}
 *   新数组，顺序与输入一致；每项带 answerCount。
 */
export async function enrichAnswerCounts(candidates, config, { delay = humanDelay } = {}) {
  const enriched = [];
  for (const cand of candidates) {
    let answerCount = null;
    try {
      const url = buildQuestionInfoUrl(cand.questionId);
      const parsed = await requestJson(config, url, {
        retries: 0, // 预算合同：每候选至多 1 次真实 HTTP 尝试
        referer: `https://www.zhihu.com/question/${cand.questionId}`,
      });
      // 严格 count 校验：仅非负 safe integer 视为可信；异常上游值 fail closed 到 null
      // （-1 / 1.5 / "12" / null / missing 一律 null，绝不伪造、绝不把未知显示为 0）
      const n = parsed?.answer_count;
      answerCount = Number.isSafeInteger(n) && n >= 0 ? n : null;
    } catch {
      // enrichment failure != search failure：单候选失败 → null，search 继续
      answerCount = null;
    }
    enriched.push({ ...cand, answerCount });
    await delay();
  }
  return enriched;
}

/**
 * search 命令入口：Cookie 可用 → enrichment；Cookie 不可用 → 全部降级为 null。
 * 两种情况下 search 本身都继续成功。
 *
 * @param {Array<object>} candidates 最终候选
 * @param {{loadConfigImpl?: () => object, delay?: () => Promise<void>}} [options]
 * @returns {Promise<Array<object>>} 带 answerCount 的候选数组
 */
export async function applyAnswerCountEnrichment(candidates, { loadConfigImpl = loadConfig, delay } = {}) {
  let config = null;
  try {
    config = loadConfigImpl();
  } catch {
    // Cookie 不可用不是 search 失败：仅 enrichment 降级
    config = null;
  }
  if (!config) {
    return candidates.map((c) => ({ ...c, answerCount: null }));
  }
  return enrichAnswerCounts(candidates, config, { delay });
}
