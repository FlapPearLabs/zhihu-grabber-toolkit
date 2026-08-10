// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { buildAnswersUrl, buildQuestionInfoUrl, humanDelay, requestJson } from './http.js';
import { extractAssets } from './asset-extractor.js';
import { richHtmlToMarkdown } from './rich-renderer.js';

const DEFAULT_STATE = Object.freeze({ offset: 0, done: false });
/** 安全阈值：单问题最多抓 300 页（约 6000 条），防止异常分页导致无限循环 */
const MAX_PAGES = 300;

/** 校验问题 ID：纯数字白名单，拒绝一切路径注入（questionId 唯一合法性规则的事实来源） */
export function validateQuestionId(value) {
  const qid = String(value).trim();
  if (!/^\d{1,20}$/.test(qid)) {
    throw new TypeError(`非法问题 ID: ${qid}（仅接受 1-20 位数字）`);
  }
  return qid;
}

/**
 * V2 Phase 3（Spec §17.1/§17.3）：从 question info response 提取 topics。
 *
 * 真实 schema evidence（2026-08-10 schema discovery，/api/v4/questions/{qid}）：
 *   topics: array of { id: string, type: string, url: string, name: string,
 *                       avatar_url: string, topic_type: string }
 * 只持久化 Spec + 真实 schema 明确支持的最小字段 { id, name }：
 *   - id：稳定标识（topic object 内唯一）
 *   - name：展示文本（UNTRUSTED_EXTERNAL_CONTENT，进入 Markdown 前必须 escape）
 * 不保存 url / avatar_url / type / topic_type（无 Spec 支持、无必要、避免引入额外字段）。
 * 服务器未返回 topics（非数组）→ 返回 []。
 */
export function extractTopics(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  const out = [];
  for (const t of rawTopics) {
    if (!t || typeof t !== 'object') continue;
    if (t.id === undefined || t.id === null) continue;
    if (typeof t.name !== 'string') continue;
    out.push({ id: String(t.id), name: t.name });
  }
  return out;
}

/**
 * V2 Phase 3（Spec §17.1/§17.2）：从 question info response 构建 additive question 对象。
 *
 * 真实 schema evidence（2026-08-10 schema discovery）：
 *   detail: string —— 问题描述原始 HTML（canonical 来源，原样保留；无描述时为空字符串）
 *   title:  string —— 问题标题
 *   topics: array  —— 话题数组（见 extractTopics）
 *
 * descriptionMarkdown 由 descriptionHtml 经与回答正文**同一**安全 renderer 确定性派生
 * （richHtmlToMarkdown，headingOffset=2 → description 内部 heading 最多 H3，
 *  严格低于 answers.md 的 `## N.` framing，Spec §14.1.1）。
 * 不回写 descriptionHtml（canonical 原样保留，Spec §6.1/RULES §3）。
 *
 * question.id / question.title 与 canonical 顶层 questionId / questionTitle 保持一致
 * （Spec §17.1，避免第二套冲突事实；真实 server metadata 冲突时由上层 STOP 上报）。
 */
export function buildQuestionMetadata(qid, info) {
  const detail = typeof info?.detail === 'string' ? info.detail : '';
  return {
    id: String(qid),
    title: typeof info?.title === 'string' ? info.title : '',
    descriptionHtml: detail,
    descriptionMarkdown: detail ? richHtmlToMarkdown(detail, { headingOffset: 2 }) : '',
    topics: extractTopics(info?.topics),
  };
}

/** 解析输出目录并校验 containment：最终目录必须位于 outDir 之下 */
function resolveQuestionDir(outDir, qid) {
  const base = path.resolve(outDir);
  const dir = path.resolve(base, qid);
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new Error(`输出目录越界: ${dir}`);
  }
  return dir;
}

/**
 * 规范化问题输入：提取 candidate（纯数字或 URL 中的 question/<digits>），
 * 然后统一走 validateQuestionId（1-20 位数字）。
 * 完整合法性校验在此完成 → CLI 在 loadConfig 之前即可判定 invalid_input，
 * 不再依赖凭据状态。
 */
export function normalizeQuestionInput(input) {
  const trimmed = String(input).trim();
  let candidate;
  if (/^\d+$/.test(trimmed)) {
    candidate = trimmed;
  } else {
    const m = trimmed.match(/question\/(\d+)/);
    if (!m) throw new Error(`无法识别问题输入: ${trimmed}（请给问题链接或纯数字问题ID）`);
    candidate = m[1];
  }
  return validateQuestionId(candidate);
}

/** 损坏文件不静默当空处理：改名备份并抛错，防止覆盖用户已有数据 */
function corruptError(file, action) {
  let backup = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, backup);
  } catch {
    backup = null;
  }
  const where = backup ? `，已备份到 ${backup}` : '，且备份失败';
  throw new Error(`${file} 损坏，无法${action}${where}。请检查该文件后再重试。`);
}

export class ProgressStore {
  constructor(outDir, qid) {
    this.file = path.join(outDir, '.progress.json');
    this.qid = qid;
  }

  load() {
    if (!fs.existsSync(this.file)) return { ...DEFAULT_STATE };
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return corruptError(this.file, '读取断点状态');
      }
      return { ...DEFAULT_STATE, ...parsed };
    } catch (error) {
      if (error instanceof Error && error.message.includes('损坏')) throw error;
      return corruptError(this.file, '读取断点状态');
    }
  }

  save(state) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

export function shouldContinue(paging) {
  return !(paging && paging.is_end === true);
}

/** 兼容两种历史形态：纯数组，或 { …meta, answers: [] }；损坏时抛错而非静默返回空 */
export function loadExistingAnswers(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.answers)) return parsed.answers;
    return [];
  } catch {
    return corruptError(file, '加载已有回答');
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 抓取指定问题的全部回答（支持断点续传）。返回 { qid, questionTitle, answerCount, answers } */
export async function grabAll(config, qid, { outDir = 'out', onProgress } = {}) {
  qid = validateQuestionId(qid);
  const dir = resolveQuestionDir(outDir, qid);
  fs.mkdirSync(dir, { recursive: true });
  const progress = new ProgressStore(dir, qid);
  const answersFile = path.join(dir, 'answers.json');
  const state = progress.load();

  // 问题元信息
  let meta = null;
  try {
    const info = await requestJson(config, buildQuestionInfoUrl(qid), { referer: `https://www.zhihu.com/question/${qid}` });
    meta = {
      questionId: qid,
      questionTitle: info.title || '',
      answerCount: info.answer_count ?? null,
      url: `https://www.zhihu.com/question/${qid}`,
      // V2 Phase 3 additive（Spec §17.1）：question 对象。
      // id/title 与 canonical 顶层字段一致；descriptionHtml 为原始 detail HTML 原样保留；
      // descriptionMarkdown 确定性派生；topics 仅当服务器真实返回时写入。
      // 服务器未返回 description（detail 缺失/空）→ descriptionHtml/descriptionMarkdown 为明确空值 ''。
      question: buildQuestionMetadata(qid, info),
    };
  } catch (error) {
    onProgress?.({ event: 'metadata_failed', qid, error: error.message });
    // V1 语义保持：question info 失败 → 顶层元信息降级（questionTitle 为空等），core 抓取继续。
    // description 复用同一请求；该请求失败时 question 对象整体缺失（additive optional，
    // 老 reader 忽略新字段即可，Spec §18/§19）。不把 metadata 失败升级为 core fatal（Spec §20.2）。
    meta = { questionId: qid, questionTitle: '', answerCount: null, url: `https://www.zhihu.com/question/${qid}` };
  }

  const answers = loadExistingAnswers(answersFile);
  const seen = new Set(answers.map((a) => String(a.id)));
  let offset = state.offset;
  let done = state.done;
  let page = 0;
  let lastPageFingerprint = '';
  onProgress?.({ event: 'start', qid, resumeOffset: offset, existing: answers.length });

  while (!done) {
    if (page >= MAX_PAGES) {
      throw new Error(`达到安全阈值（${MAX_PAGES} 页）仍未见结尾，已停止以防无限循环。可稍后重跑续传。`);
    }
    const url = buildAnswersUrl(qid, offset);
    let data;
    try {
      data = await requestJson(config, url, { referer: `https://www.zhihu.com/question/${qid}` });
    } catch (error) {
      onProgress?.({ event: 'page_failed', offset, error: error.message });
      throw error;
    }
    // 分页结构校验，防止服务端异常导致死循环
    if (!Array.isArray(data?.data)) {
      throw new Error(`分页结构异常（data.data 不是数组），已停止: ${url}`);
    }
    const items = data.data;
    // 页面指纹：连续两页内容完全相同说明分页失效
    const fingerprint = items.slice(0, 5).map((it) => it.id).join(',');
    if (fingerprint && fingerprint === lastPageFingerprint) {
      throw new Error(`检测到重复分页（第 ${page + 1} 页与上一页相同），已停止以防无限循环。`);
    }
    lastPageFingerprint = fingerprint;

    let added = 0;
    for (const item of items) {
      const id = String(item.id);
      if (seen.has(id)) continue;
      seen.add(id);
      answers.push({
        id,
        author: item.author?.name || '',
        url: `https://www.zhihu.com/question/${qid}/answer/${id}`,
        content: item.content ?? null,
        excerpt: item.excerpt ?? '',
        voteupCount: item.voteup_count ?? 0,
        commentCount: item.comment_count ?? 0,
        createdTime: item.created_time ?? null,
        updatedTime: item.updated_time ?? null,
        // V2 Phase 2 additive：assets 是 content 的派生索引（Spec §6.1/§18），
        // 不反向修改 content；旧回答（断点续传加载、无 assets）不被改写。
        assets: extractAssets(item.content ?? ''),
      });
      added += 1;
    }
    page += 1;
    // 完成合同：只有服务端明确 paging.is_end === true 才允许 done=true。
    // 空数据但 is_end !== true 是 fail-closed —— 拒绝标记抓取完成，避免"假抓全"。
    const serverSaysEnd = data?.paging?.is_end === true;
    if (items.length === 0 && !serverSaysEnd) {
      throw new Error('分页返回空数据，但服务端未声明 is_end=true，拒绝标记抓取完成。');
    }
    done = serverSaysEnd;
    const snapshot = { ...meta, fetchedAt: new Date().toISOString(), answers };
    writeJson(answersFile, snapshot);
    progress.save({ offset: offset + items.length, done });
    onProgress?.({ event: 'page', page, offset, fetched: added, total: answers.length, isEnd: done });
    if (!done) await humanDelay();
    offset += items.length;
  }

  return { ...meta, fetchedAt: new Date().toISOString(), answers };
}
