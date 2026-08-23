// SPDX-License-Identifier: MIT
/**
 * lmstudio-projection — deterministic Agent analysis projection for the
 * supported lmstudio-local-tool-less runtime (T6, Issue #12).
 *
 * V2 §9.2 projection contract: the projection is generated at the corpus
 * chunk/map boundary by deterministic code; untrusted Zhihu content is DATA,
 * never instruction. The projection must not expose full external URLs or
 * filesystem paths to the model (V2 §9.2 / §11.6), and it must pass the
 * reviewed T5-LM controller boundary (corpus-anthology/lib/lmstudio-tool-less.mjs),
 * which fails closed on any remote/file reference.
 *
 * This module is controller-side trusted code: it deterministically neutralizes
 * reference-like tokens in untrusted text before the model ever sees them.
 */

/**
 * 消毒正则是被评审控制器（lmstudio-tool-less.mjs hasRemoteOrFileReference）
 * 拒绝文法的**超集**：控制器的路径前缀 `(?:^|[\s=("'])?` 是可选组、`//`/`\`
 * 任意位置即拒绝，因此消毒器必须对 CJK 相邻的路径类 token（如「修改/etc/hosts」、
 * 「配置~/.zshrc」、「甲//乙」）同样生效。任何控制器会拒绝的形态都必须被中和，
 * 否则真实中文语料会让整个 chunk fail-closed。
 */
const SCHEME_PATTERN = /(?:^|[^A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:)[^\s'"<>]*/gu;
const DOUBLE_SLASH_PATTERN = /\/\/[^\s]*/gu;
const BACKSLASH_PATTERN = /\\[^\s]*/gu;
const WWW_PATTERN = /\bwww\.[^\s'"<>]*/giu;
const DOTDOT_PATTERN = /\.\.?\/[^\s]*/gu;
const PATH_PATTERN = /(?:^|[\s=("'])?((?:~\/|\$HOME\/|\.\.?\/|\/)[A-Za-z0-9._~/-]+)/gu;
const SOURCE_TAG_CLOSED = /\[SOURCE[^\]]*\]/giu;
const SOURCE_TAG_OPEN = /\[SOURCE/giu;

/**
 * 消毒占位符使用无方括号的括号形式（如（外部链接）），保证 `[SOURCE <id>]` 是投影中
 * 唯一的方括号 token——实测 1.7B 会把正文中的方括号 token 误抄进 sourceId 回显。
 * 正文中的 `[SOURCE ...]`（闭合）与未闭合的 `[SOURCE` 都被中和（控制器对任何含
 * [SOURCE 的行执行 source-tag 契约，无论是否闭合）。
 */
function replaceRefs(text) {
  let out = text;
  out = out.replace(SCHEME_PATTERN, (_m, scheme) => ` （链接协议${scheme.slice(0, -1)}）`);
  out = out.replace(DOUBLE_SLASH_PATTERN, ' （外部链接）');
  out = out.replace(BACKSLASH_PATTERN, ' （路径）');
  out = out.replace(WWW_PATTERN, ' （外部链接）');
  out = out.replace(DOTDOT_PATTERN, ' （路径）');
  out = out.replace(PATH_PATTERN, ' （路径）');
  out = out.replace(SOURCE_TAG_CLOSED, ' （来源标记）');
  out = out.replace(SOURCE_TAG_OPEN, ' （来源标记）');
  return out;
}

/**
 * 消毒不可信文本：先移除全部百分号（连同解码形态一起消除，杜绝 %2F 等编码绕过），
 * 再中和 URL / 协议 / 路径 / 反斜杠 token，最后去除控制器会拒绝的不可见/控制字符。
 * 与已评审控制器（lmstudio-tool-less.mjs）的 fail-closed 边界保持一致。
 */
export function sanitizeProjectionText(text) {
  const noPercent = String(text ?? '').replace(/%/gu, ' ');
  const neutralized = replaceRefs(noPercent);
  return neutralized
    .replace(/[\p{Cf}\p{Cs}]/gu, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '');
}

const PLACEHOLDER_PATTERN = /（外部链接）|（路径）|（链接协议[^）]*）/gu;

/** 消毒并剥离占位符后是否仍存在可提取的语义内容。 */
export function hasExtractableContent(text) {
  return sanitizeProjectionText(text).replace(PLACEHOLDER_PATTERN, '').trim() !== '';
}

/**
 * 生成确定性 Agent analysis projection。
 *
 * 真实 corpus sourceId（如 `question-448089541-answer-1001`）较长，1.7B 模型
 * 无法可靠回显（实测会截断/改写）；因此调用方使用**短不透明 token** 作为
 * projection 的 sourceId（模型只回显 token），由 controller 侧映射回真实 ID。
 * 已评审控制器合同不变：projection 声明单一 sourceId，模型必须回显同一值。
 *
 * @param {object} param0
 * @param {string} param0.sourceId - 单一来源标识（可为短 token，须符合受限文法）
 * @param {string} param0.text - 该来源的 stripHtml 后纯文本（未经消毒）
 * @param {string} [param0.meta] - 可选的确定性来源元信息行（如「来源: 用户甲（赞同 120）」），同样消毒
 * @returns {{kind: 'deterministic-analysis-projection', sourceIds: string[], text: string}}
 *   投影文本为 `[SOURCE <sourceId>]\n[meta]\n<消毒后的正文>`，且保证通过已评审控制器边界。
 */
export function buildProjection({ sourceId, text, meta }) {
  if (typeof sourceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sourceId)) {
    throw new Error(`capability_isolation_unavailable: invalid source ID: ${sourceId}`);
  }
  const sanitized = sanitizeProjectionText(text);
  const metaLine = meta == null || String(meta).trim() === ''
    ? ''
    : `${sanitizeProjectionText(meta)}\n`;
  if (sanitized.trim() === '' && metaLine.trim() === '') {
    throw new Error(`capability_isolation_unavailable: projection content is empty after sanitization`);
  }
  return {
    kind: 'deterministic-analysis-projection',
    sourceIds: [sourceId],
    text: `[SOURCE ${sourceId}]\n${metaLine}${sanitized}`,
  };
}

/** 将 chunk 文本按 `\n\n---\n\n` 拆分为逐来源片段（保留 [SOURCE id] 头）。 */
export function splitChunkBySource(chunk) {
  const sections = String(chunk.text ?? '').split(/\n\n---\n\n/u);
  const bySource = new Map();
  for (const section of sections) {
    const match = /^\[SOURCE ([A-Za-z0-9][A-Za-z0-9._-]{0,127})\](?:\n|$)/u.exec(section.trimStart());
    if (!match) {
      throw new Error(`capability_isolation_unavailable: chunk section missing SOURCE tag`);
    }
    bySource.set(match[1], section.trimStart());
  }
  const sourceIds = Array.isArray(chunk.sourceIds) ? chunk.sourceIds : [];
  for (const sourceId of sourceIds) {
    if (!bySource.has(sourceId)) {
      throw new Error(`capability_isolation_unavailable: chunk is missing section for source ${sourceId}`);
    }
  }
  if (bySource.size !== sourceIds.length) {
    throw new Error(`capability_isolation_unavailable: chunk sections do not match declared source IDs`);
  }
  return bySource;
}

/** 置信度 → corpus map claim 的 high/medium/low（T11-R1 #27：wire 已用枚举，直接透传；数值映射保留给确定性合成条目）。 */
export function mapConfidence(value) {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 0.66) return 'high';
  if (n >= 0.33) return 'medium';
  return 'low';
}

/** 控制器输出的 per-source result → corpus sourceCoverage 条目（确定性映射）。 */
export function toSourceCoverage(result) {
  return {
    sourceId: result.sourceId,
    summary: result.summary,
    disposition: 'substantive',
  };
}

/** 控制器输出的 per-source result → corpus claim（确定性映射）。 */
export function toClaim(result) {
  return {
    claim: result.summary,
    evidenceSourceIds: [result.sourceId],
    confidence: mapConfidence(result.confidence),
  };
}
