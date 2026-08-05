import fs from 'node:fs';
import path from 'node:path';
import { buildAnswersUrl, buildQuestionInfoUrl, humanDelay, requestJson } from './http.js';

const DEFAULT_STATE = Object.freeze({ offset: 0, done: false });

export function normalizeQuestionInput(input) {
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/question\/(\d+)/);
  if (m) return m[1];
  throw new Error(`无法识别问题输入: ${trimmed}（请给问题链接或纯数字问题ID）`);
}

export class ProgressStore {
  constructor(outDir, qid) {
    this.file = path.join(outDir, '.progress.json');
    this.qid = qid;
  }

  load() {
    if (!fs.existsSync(this.file)) return { ...DEFAULT_STATE };
    try {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return { ...DEFAULT_STATE };
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

/** 兼容两种历史形态：纯数组，或 { …meta, answers: [] } */
export function loadExistingAnswers(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.answers)) return parsed.answers;
    return [];
  } catch {
    return [];
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
  const dir = path.join(outDir, qid);
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
      answerCount: info.answer_count ?? 0,
      url: `https://www.zhihu.com/question/${qid}`,
    };
  } catch (error) {
    meta = { questionId: qid, questionTitle: '', answerCount: 0, url: `https://www.zhihu.com/question/${qid}` };
  }

  const answers = loadExistingAnswers(answersFile);
  const seen = new Set(answers.map((a) => String(a.id)));
  let offset = state.offset;
  let done = state.done;
  let page = 0;
  onProgress?.({ event: 'start', qid, resumeOffset: offset, existing: answers.length });

  while (!done) {
    const url = buildAnswersUrl(qid, offset);
    let data;
    try {
      data = await requestJson(config, url, { referer: `https://www.zhihu.com/question/${qid}` });
    } catch (error) {
      onProgress?.({ event: 'page_failed', offset, error: error.message });
      throw error;
    }
    const items = data?.data || [];
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
    done = !shouldContinue(data?.paging) || items.length === 0;
    if (!done && items.length === 0) done = true; // 空页兜底
    const snapshot = { ...meta, fetchedAt: new Date().toISOString(), answers };
    writeJson(answersFile, snapshot);
    progress.save({ offset: offset + items.length, done });
    onProgress?.({ event: 'page', page, offset, fetched: added, total: answers.length, isEnd: done });
    if (!done) await humanDelay();
    offset += items.length;
  }

  return { ...meta, fetchedAt: new Date().toISOString(), answers };
}
