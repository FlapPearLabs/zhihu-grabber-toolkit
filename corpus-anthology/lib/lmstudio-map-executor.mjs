// SPDX-License-Identifier: MIT
/**
 * lmstudio-map-executor — per-source Agent map execution for the supported
 * lmstudio-local-tool-less runtime (T6, Issue #12).
 *
 * Design: the reviewed T5-LM qualification schema is single-source and strict
 * minimal (the local 1.7B model cannot reliably satisfy a full multi-source
 * coverage contract — a model-quality fact, not an isolation fact). Therefore
 * each source in a chunk is projected, sent to the tool-less runtime, and
 * deterministically validated as its own request; the trusted controller then
 * assembles the corpus map result (evidence-schema.md) with full coverage.
 *
 * Fail-closed: if ANY source request fails validation or transport, the whole
 * chunk map fails and nothing is written — no partial map, no silent skip,
 * no prompt-only downgrade. The model never sees the assembled map, other
 * chunks, or any controller IO.
 */

import { runToolLessMap } from './lmstudio-tool-less.mjs';
import {
  buildProjection,
  hasExtractableContent,
  mapConfidence,
  splitChunkBySource,
  toClaim,
  toSourceCoverage,
} from './lmstudio-projection.mjs';

function fail(message) {
  throw new Error(`capability_isolation_unavailable: ${message}`);
}

/** 空正文来源的确定性 controller 条目：不调用模型，保留全覆盖语义。 */
export const EMPTY_SOURCE_SUMMARY = '来源正文为空，无观点可提取。';
/** 正文非空但消毒后无可提取语义内容（如整段都是 URL/路径）的确定性条目。 */
export const NO_EXTRACTABLE_SOURCE_SUMMARY = '来源正文无可提取的语义内容。';

/** 去除片段开头的 [SOURCE id] 行，返回正文内容。 */
export function stripSourceTag(section) {
  return section.replace(/^\[SOURCE [A-Za-z0-9][A-Za-z0-9._-]{0,127}\]\s*/u, '');
}

/**
 * 对单个 chunk 执行 per-source map 并确定性装配 corpus map 结果。
 * 任何来源失败 → 整个 chunk 失败（fail closed），不产出部分结果。
 *
 * @param {object} chunk - work/chunks/chunk-*.json 对象（chunkId/sourceIds/sources/text/chars/chunkHash）
 * @param {object} [options]
 * @param {object} [options.run] - 覆盖 runToolLessMap（测试注入）
 * @param {number} [options.maxSummaryChars] - 装配 summary 的最大字符预算
 * @returns {Promise<object>} 符合 evidence-schema.md 的 map 结果
 */
export async function runChunkMap(chunk, { run = runToolLessMap, maxSummaryChars = 300 } = {}) {
  if (!chunk || typeof chunk !== 'object'
    || typeof chunk.chunkId !== 'string'
    || !Array.isArray(chunk.sourceIds)
    || chunk.sourceIds.length === 0
    || typeof chunk.chunkHash !== 'string'
    || chunk.chunkHash.trim() === ''
    || typeof chunk.text !== 'string') {
    fail('chunk is missing required identity fields');
  }
  if (typeof run !== 'function') fail('no map transport provided');

  const sections = splitChunkBySource(chunk);
  const results = [];
  const perSourceSummaries = [];

  for (let index = 0; index < chunk.sourceIds.length; index += 1) {
    const realId = chunk.sourceIds[index];
    const section = sections.get(realId);
    const rawContent = stripSourceTag(section);
    // 空正文来源：controller 确定性合成条目，不调用模型（模型对空内容无忠实摘要可产出）
    if (rawContent.trim() === '') {
      results.push({ sourceId: realId, summary: EMPTY_SOURCE_SUMMARY, stance: 'neutral', confidence: 0, synthesized: true });
      perSourceSummaries.push(EMPTY_SOURCE_SUMMARY);
      continue;
    }
    // 正文非空但消毒后无可提取内容（如整段都是 URL/路径）：同样由 controller 合成，不调用模型
    if (!hasExtractableContent(rawContent)) {
      results.push({ sourceId: realId, summary: NO_EXTRACTABLE_SOURCE_SUMMARY, stance: 'neutral', confidence: 0, synthesized: true });
      perSourceSummaries.push(NO_EXTRACTABLE_SOURCE_SUMMARY);
      continue;
    }
    // 短不透明 token（T11-R1 #27：模型不再回显身份；token 仅作投影内来源引用，
    // controller 从请求状态确定性归属真实 sourceId）
    const token = String(index + 1);
    const sourceMeta = Array.isArray(chunk.sources)
      ? chunk.sources.find((s) => s && s.sourceId === realId)
      : null;
    // 投影 meta 最小化：仅保留安全作者名；voteupCount 是 controller/corpus 元数据，
    // 不进模型可见投影（T11 实测 meta 数字/作者被模型抄进输出字段造成污染）
    const meta = sourceMeta
      ? `来源: ${sourceMeta.author ?? '(匿名)'}`
      : '';
    let projection;
    try {
      // section 已含 [SOURCE id] 头；buildProjection 会再包一层 tag，故先剥离正文
      projection = buildProjection({ sourceId: token, text: rawContent, meta });
    } catch (error) {
      fail(`projection for ${realId} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let result;
    try {
      result = await run({ projection });
    } catch (error) {
      fail(`map for source ${realId} failed closed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // run 的成功契约：已通过控制器确定性校验（summary/stance/confidence 枚举合法，
    // 无 sourceId 字段——模型不得拥有身份）；controller 从 trusted 请求状态归属真实 sourceId
    if (!result || typeof result !== 'object'
      || typeof result.summary !== 'string'
      || result.summary.trim() === ''
      || !['positive', 'neutral', 'negative'].includes(result.stance)
      || !['high', 'medium', 'low'].includes(result.confidence)
      || Object.hasOwn(result, 'sourceId')) {
      fail(`map for source ${realId} returned an invalid validated result`);
    }
    results.push({ ...result, sourceId: realId });
    perSourceSummaries.push(result.summary.trim());
  }

  // 确定性装配（controller 侧，模型不可见）
  const sourceCoverage = results.map(toSourceCoverage);
  const claims = results.map(toClaim);

  let summary = perSourceSummaries.join('；');
  if (summary.length > maxSummaryChars) {
    summary = `${summary.slice(0, maxSummaryChars - 1)}…`;
  }

  return {
    chunkId: chunk.chunkId,
    chunkHash: chunk.chunkHash,
    sourceIds: [...chunk.sourceIds],
    summary,
    claims,
    themes: [],
    uncertainties: [],
    sourceCoverage,
  };
}
