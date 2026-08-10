// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { buildAnswersUrl, buildCommentsUrl, buildQuestionInfoUrl, humanDelay, requestJson } from './http.js';
import { extractAssets } from './asset-extractor.js';
import { richHtmlToMarkdown } from './rich-renderer.js';

const DEFAULT_STATE = Object.freeze({ offset: 0, done: false });
/** 安全阈值：单问题最多抓 300 页（约 6000 条），防止异常分页导致无限循环 */
const MAX_PAGES = 300;
/** V2 Phase 4（Spec §15.3）：comments enrichment 最多处理的 selected answers */
const MAX_SELECTED_ANSWERS = 10;

/** 校验问题 ID：纯数字白名单，拒绝一切路径注入（questionId 唯一合法性规则的事实来源） */
export function validateQuestionId(value) {
  const qid = String(value).trim();
  if (!/^\d{1,20}$/.test(qid)) {
    throw new TypeError(`非法问题 ID: ${qid}（仅接受 1-20 位数字）`);
  }
  return qid;
}

/**
 * 稳定的身份冲突错误（P1-4 / 任务 §8 QUESTION_METADATA_IDENTITY_CONFLICT）。
 *
 * 当 server question info 返回的 id 与请求的 canonical qid 不一致时抛出。
 * 这是**身份冲突**，不是普通 metadata enrichment 失败：
 * 不得被 metadata_failed 分支吞掉降级（不得静默选择一方覆盖另一方）。
 */
export class QuestionMetadataIdentityError extends Error {
  constructor(qid, serverId) {
    super(`QUESTION_METADATA_IDENTITY_CONFLICT: 服务端返回问题 id ${serverId} 与请求问题 ${qid} 不一致`);
    this.name = 'QuestionMetadataIdentityError';
    this.errorType = 'question_metadata_identity_conflict';
    this.qid = qid;
    this.serverId = serverId;
  }
}

/**
 * V2 Phase 3（Spec §17.1/§17.3）：从 question info response 提取 topics。
 *
 * 真实 schema evidence（2026-08-10 schema discovery，/api/v4/questions/{qid}）：
 *   topics: array of { id: string, type: string, url: string, name: string,
 *                       avatar_url: string, topic_type: string }
 * 只持久化 Spec + 真实 schema 明确支持的最小字段 { id, name }：
 *   - id：稳定标识（实测 type=string）
 *   - name：展示文本（实测 type=string；UNTRUSTED_EXTERNAL_CONTENT，进入 Markdown 前必须 escape）
 * 严格按 observed schema 校验：id 与 name 均须为 string，拒绝任意对象 String() 强转
 * （P2-1：不产生 "[object Object]" 之类伪造 id）。
 * 不保存 url / avatar_url / type / topic_type（无 Spec 支持、无必要、避免引入额外字段）。
 *
 * 注意：本函数只接受**数组**输入；"topics 字段缺失/类型不对"由调用方
 * （buildQuestionMetadata）负责省略 question.topics（P1-1：missing != []）。
 */
export function extractTopics(rawTopics) {
  if (!Array.isArray(rawTopics)) return [];
  const out = [];
  for (const t of rawTopics) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.id !== 'string') continue;
    if (typeof t.name !== 'string') continue;
    out.push({ id: t.id, name: t.name });
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
 * **missing vs empty 严格区分（P1-1 / approved QUESTION_METADATA_FAILURE_SEMANTICS #4/#7）**：
 *   detail 是 string（含 ""）→ descriptionHtml = 该 raw 值（"" = 明确无描述），
 *                                  descriptionMarkdown = 确定性派生（"" 时为 ""）
 *   detail 缺失 / 非 string  → 不写 descriptionHtml / descriptionMarkdown（缺省，不伪造 ""）
 *   topics 明确返回 []（空数组）→ topics = []（服务器明确 0 个话题）
 *   topics 非空数组 且 至少 1 个合法 item → topics = 合法子集
 *   topics 非空数组 但 0 个合法 item（全部 schema 不合法）→ **不写** question.topics
 *     （不得把 non-empty-but-unusable 伪装成服务器明确返回 []，P1-NEW-1）
 *   topics 缺失 / 非 array → 不写 question.topics（缺省，不伪造 []）
 *
 * question.id 恒等于 canonical qid（身份一致性由 grabAll 在 identity gate 保障）；
 * question.title 由调用方传入同一个 canonical title 值（单一归一化来源，P1-4）。
 */
export function buildQuestionMetadata(qid, info, canonicalTitle) {
  const q = { id: String(qid), title: canonicalTitle };
  if (typeof info?.detail === 'string') {
    q.descriptionHtml = info.detail;
    q.descriptionMarkdown = info.detail ? richHtmlToMarkdown(info.detail, { headingOffset: 2 }) : '';
  }
  if (Array.isArray(info?.topics)) {
    if (info.topics.length === 0) {
      // 服务器明确返回 topics: [] → 真实空值
      q.topics = [];
    } else {
      const valid = extractTopics(info.topics);
      if (valid.length > 0) {
        // 至少 1 个合法 item → 持久化合法子集
        q.topics = valid;
      }
      // 非空但 0 个合法 item → omit（不伪造 []）
    }
  }
  return q;
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

/**
 * V2 Phase 3（P1-1/re-review）：读取已有产物中**canonical-compatible**的
 * additive `question` 对象，供 resume 场景使用。
 *
 * 仅当 fresh metadata 请求失败时调用：若磁盘已有此前成功持久化的
 * 合法且**与当前 qid/产物兼容**的 question（durable fact），保留它而非抹掉。
 *
 * 可复用判定（re-review P1-1 + P2-NEW-1，逐项校验，不允许绕过 identity gate 或破坏
 * `question.title === questionTitle` 不变量）：
 *   artifact.questionId  === 当前 qid（均须 string，拒绝 numeric ID 强转）
 *   question.id          === 当前 qid（均须 string，拒绝 numeric ID 强转）
 *   question.title       string
 *   artifact.questionTitle string
 *   question.title       === artifact.questionTitle
 *   optional descriptionHtml    : absent 或 string
 *   optional descriptionMarkdown: absent 或 string
 *   optional topics             : absent 或 array（保留项均 {id:string, name:string}）
 *
 * 返回 { question, questionTitle }（canonical title 一并保留，保持
 * `question.title === questionTitle`）；不兼容/缺失 → null。
 * 文件损坏时不在此抛错（由 loadExistingAnswers / corruptError 统一处理）。
 */
export function loadExistingQuestion(file, qid) {
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.questionId !== 'string' || parsed.questionId !== qid) return null;
  const q = parsed.question;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null;
  if (typeof q.id !== 'string' || q.id !== qid) return null;
  if (typeof q.title !== 'string') return null;
  if (typeof parsed.questionTitle !== 'string') return null;
  if (q.title !== parsed.questionTitle) return null;
  if ('descriptionHtml' in q && typeof q.descriptionHtml !== 'string') return null;
  if ('descriptionMarkdown' in q && typeof q.descriptionMarkdown !== 'string') return null;
  if ('topics' in q) {
    if (!Array.isArray(q.topics)) return null;
    for (const t of q.topics) {
      if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.name !== 'string') return null;
    }
  }
  return { question: q, questionTitle: parsed.questionTitle };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * V2 Phase 4（Spec §15.7）：v1-compatible comments validator。
 *
 * 仅用于 SELECTED + fresh comments failure 的 fallback 判定（§15.7-D）：
 * 既有 comments 为 v1-compatible → preserve；否则 refreshed canonical result 中 omit。
 * comments OFF（B）与 not-selected（C）路径不得使用本 validator（原样 preserve，不 inspect）。
 *
 * v1-compatible 定义：
 *   Array、length <= 3；
 *   每 item：非 null object、contentHtml REQUIRED string、contentMarkdown REQUIRED string、
 *   authorName absent|string、createdTime absent|number；未知 extra keys 允许（additive 向前兼容）。
 */
export function isV1CompatibleComments(value) {
  if (!Array.isArray(value) || value.length > 3) return false;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    if (typeof item.contentHtml !== 'string') return false;
    if (typeof item.contentMarkdown !== 'string') return false;
    if ('authorName' in item && typeof item.authorName !== 'string') return false;
    if ('createdTime' in item && !Number.isFinite(item.createdTime)) return false;
  }
  return true;
}

/**
 * V2 Phase 4（Spec §15.3）：deterministic high-value answer selection。
 *
 * 取最多 max 个 answer，按 canonical answer.voteupCount DESC，
 * tie 保持 canonical answer capture order（原数组顺序，稳定排序）。
 * 不使用 voteup_count / commentCount 作为 canonical selection 键。
 */
export function selectTopAnswers(answers, max = 10) {
  return answers
    .slice()
    .sort((a, b) => (b.voteupCount ?? 0) - (a.voteupCount ?? 0))
    .slice(0, max);
}

/**
 * V2 Phase 4（Spec §15.4/§15.6）：从 root_comment response 确定性提取 Top3 root items。
 *
 * 返回 { comments, isExplicitZero }；任何 schema 违约抛错（该 answer enrichment 失败）：
 *   - data 非数组 / 非对象响应 → failure
 *   - explicit zero（唯一来源）：data=[] && paging.totals===0 && paging.is_end===true → []
 *   - data=[] 但 totals>0 → failure（不得伪造 []）
 *   - 目标 Top3 中任一 item 违反 root/content contract → failure（不得过滤后用后续 item 补位）
 *
 * root predicate（raw response identity validation）：
 *   typeof item.id === "string" && reply_comment_id === "0" &&
 *   typeof item.reply_root_comment_id === "string" && reply_root_comment_id === item.id &&
 *   typeof item.content === "string"
 *
 * child_comments 完全忽略；comment id / score / like_count 等不进入 public schema。
 */
export function extractTopComments(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('评论响应不是对象');
  }
  const data = response.data;
  if (!Array.isArray(data)) {
    throw new Error('评论响应 data 不是数组');
  }
  const totals = response.paging?.totals;
  const isEnd = response.paging?.is_end;
  if (data.length === 0) {
    // explicit zero：唯一合法来源（Spec §15.7）
    if (totals === 0 && isEnd === true) {
      return { comments: [], isExplicitZero: true };
    }
    // data=[] 但 totals>0（或分页矛盾）→ enrichment/schema failure，不得伪造 []
    throw new Error('评论响应异常：data=[] 但非 explicit zero（totals 或 is_end 不满足）');
  }
  const top = data.slice(0, 3);
  for (const item of top) {
    if (typeof item?.id !== 'string'
      || item.reply_comment_id !== '0'
      || typeof item.reply_root_comment_id !== 'string'
      || item.reply_root_comment_id !== item.id
      || typeof item.content !== 'string') {
      throw new Error('评论 item 违反 root/content schema');
    }
  }
  const comments = top.map((item) => {
    const out = {
      contentHtml: item.content, // server raw string 原样（不 trim / 不 sanitize 回写）
      contentMarkdown: richHtmlToMarkdown(item.content), // 同一 rich renderer 确定性派生
    };
    if (typeof item.author?.name === 'string') out.authorName = item.author.name;
    if (Number.isFinite(item.created_time)) out.createdTime = item.created_time;
    return out;
  });
  return { comments, isExplicitZero: false };
}

/** 抓取指定问题的全部回答（支持断点续传）。返回 { qid, questionTitle, answerCount, answers } */
export async function grabAll(config, qid, { outDir = 'out', onProgress, comments = false } = {}) {
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
    // P1-4 identity gate：server 返回的问题 id 必须与请求 canonical qid 一致。
    // 不一致是身份冲突（非普通 enrichment 失败），抛出稳定错误并向上传播，
    // 不得被 metadata_failed 分支吞掉（不得静默选择一方覆盖另一方）。
    if (info?.id !== undefined && info?.id !== null && String(info.id) !== qid) {
      throw new QuestionMetadataIdentityError(qid, String(info.id));
    }
    // 单一 canonical title 归一化来源（P1-4）：top-level 与 question.title 用同一值。
    const canonicalTitle = typeof info?.title === 'string' ? info.title : '';
    meta = {
      questionId: qid,
      questionTitle: canonicalTitle,
      answerCount: info.answer_count ?? null,
      url: `https://www.zhihu.com/question/${qid}`,
      // V2 Phase 3 additive（Spec §17.1）：question 对象。
      // 详情见 buildQuestionMetadata（missing vs empty 区分见 P1-1 / approved clarification）。
      question: buildQuestionMetadata(qid, info, canonicalTitle),
    };
  } catch (error) {
    // 身份冲突是核心事实错误：不是 enrichment，直接向上抛（CLI 将归类为
    // question_metadata_identity_conflict，且不吞进 metadata_failed 事件）。
    if (error instanceof QuestionMetadataIdentityError) throw error;
    onProgress?.({ event: 'metadata_failed', qid, error: error.message });
    // V1 语义保持：question info 失败 → 顶层元信息降级（questionTitle 为空等），core 抓取继续。
    // description 复用同一请求；该请求失败时 question 对象缺省（additive optional，
    // 老 reader 忽略新字段即可，Spec §18/§19）。不把 metadata 失败升级为 core fatal
    // （Spec §20.2 / approved QUESTION_METADATA_FAILURE_SEMANTICS #2）。
    // P1-1/re-review：若磁盘已有**canonical-compatible**的 question（此前成功
    // 抓取的 durable fact，且与当前 qid/title 一致），必须保留它及其对应的
    // canonical questionTitle，保持 `question.title === questionTitle` 不变量；
    // 不得因本次临时 enrichment 失败抹掉，也不得保留不兼容/错 id 的 question。
    const existing = loadExistingQuestion(answersFile, qid);
    meta = {
      questionId: qid,
      questionTitle: existing !== null ? existing.questionTitle : '',
      answerCount: null,
      url: `https://www.zhihu.com/question/${qid}`,
      ...(existing !== null ? { question: existing.question } : {}),
    };
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

  // V2 Phase 4（Spec §15.3/§15.7）：comments enrichment —— 仅在 core answers pagination 完整成功后执行。
  // comments OFF（默认）：NETWORK_REQUEST_DELTA = 0，不产生任何 comments 请求；
  // 既有 answer.comments（B 路径）不触碰，原样保留。
  if (comments === true) {
    const selected = selectTopAnswers(answers, MAX_SELECTED_ANSWERS);
    for (let i = 0; i < selected.length; i += 1) {
      const answer = selected[i];
      // 低频限速（Phase 4 CODE review P1-1）：delay 控制"下一次请求何时允许发出"，
      // 位于每次请求之前（除第一个），与上一个 selected answer 的结果无关——
      // 无论前一请求成功、HTTP/network 失败或 schema 失败，都不会造成紧邻 burst。
      if (i > 0) await humanDelay();
      // 每个 selected answer 至多 1 次真实 HTTP 尝试（Spec §15.3 / reviewer 确认的 retries=0 预算合同）。
      // 注意：requestJson 默认 retries=2 会在 429/5xx 下最多发 3 次实际 HTTP 请求，
      // 会暗中突破"≤1 request/answer"预算；comments 请求必须显式 retries: 0。
      let parsed;
      try {
        parsed = await requestJson(config, buildCommentsUrl(answer.id), {
          retries: 0,
          referer: `https://www.zhihu.com/question/${qid}`,
        });
      } catch {
        // SELECTED + fresh failure：v1-compatible 既有 comments → preserve；否则 omit
        if (!isV1CompatibleComments(answer.comments)) {
          delete answer.comments;
        }
        onProgress?.({ event: 'comments_failed', qid });
        continue;
      }
      try {
        const { comments, isExplicitZero } = extractTopComments(parsed);
        // SELECTED + success → replace；explicit zero → replace []（均不 merge 旧评论）
        answer.comments = comments;
        onProgress?.({ event: 'comments_ok', qid, answerId: answer.id, count: comments.length, isExplicitZero });
      } catch {
        // SELECTED + schema failure：v1-compatible 既有 comments → preserve；否则 omit
        if (!isV1CompatibleComments(answer.comments)) {
          delete answer.comments;
        }
        onProgress?.({ event: 'comments_failed', qid });
      }
    }
    // enrichment 完成后写最终 canonical 快照（comments 只进 additive JSON，answers.md 布局不变）
    writeJson(answersFile, { ...meta, fetchedAt: new Date().toISOString(), answers });
  }

  return { ...meta, fetchedAt: new Date().toISOString(), answers };
}
