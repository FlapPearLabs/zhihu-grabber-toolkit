// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { buildAnswersUrl, buildQuestionInfoUrl, humanDelay, requestJson } from './http.js';

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
    };
  } catch (error) {
    onProgress?.({ event: 'metadata_failed', qid, error: error.message });
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
