// SPDX-License-Identifier: AGPL-3.0-only
/**
 * verifier — 抓取产物验证的**单一事实来源**。
 *
 * verify-output.mjs（CLI）、status（captured 后的验收）、make-handoff.mjs
 * 全部复用本函数，禁止各自复制验证逻辑。
 *
 * verifyOutput(questionDir) → result
 *   result.valid === true 才表示产物通过完整验收（captured → verified）。
 *   result.valid === false 时 warnings 给出全部失败原因。
 *
 * 校验项（与原 verify-output.mjs 保持语义一致）:
 *   1. 输出目录存在
 *   2. answers.json 可解析
 *   3. answers 是数组
 *   4. 每条回答 ID 合法
 *   5. 回答 ID 无重复
 *   6. .progress.json 可解析
 *   7. done === true
 *   8. JSON 中回答数量与实际数组长度一致（captured vs reported，仅提示不设失败门）
 *   9. Markdown 文件存在
 *  10. Markdown 与 JSON 记录数一致
 *  11. 输出不是空文件
 *  12. 无损坏状态文件（.corrupt-*）
 *  13. 无中途失败标记
 *  14. answers.json.questionId 与输出目录名一致（三方一致：目录 = JSON = handoff）
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// F1 修复（OPTION 1）：fence-aware 答案帧计数
// ---------------------------------------------------------------------------
// 背景：verifier 曾用 /^## \d+\./gm 统计 renderer 答案帧（render.js 每回答恰好一帧
// `## N. 作者 — N 赞 · N 评论`）。该正则不感知 fenced code —— 回答正文代码块内的
// `## N.` 文本（如 markdown 示例）会被误计为答案帧，导致 valid=false 假阴性
// （VERIFIER_FALSE_POSITIVE_FENCED_CODE；真实数据 538 帧 + 7 fenced-code 假匹配 → 545）。
//
// 证据链（fenced code 是正文中唯一能原样保留 `## N.` 的通道）：
//   - 正文纯文本 `#` 全部经 escapeUntrustedMarkdownText 转义（markdown-security.js
//     MD_CONTROL_RE 含 #），`## 1.` → `\#\# 1.`，不匹配 /^## \d+\./；
//   - 正文 heading 经 rich-renderer heading offset（h1→H3）永不产生 H2；
//   - renderPre 原样输出 code 文本（fence 长度自适应 = longestBacktickRun+1）。
//
// fence 语义（CommonMark 子集，与 renderer 合同一致，行首无缩进）：
//   - open：行首 3+ backtick + 可选 info string（renderer lang 白名单保证不含 backtick；
//     注意 langPart 带前导空格，如 "``` js"，info 组必须允许空白）；
//   - close：行首 3+ backtick（长度 ≥ open 长度）+ 仅空白；
//   - 自适应 fence 保证 fence 内任何行的 backtick 串 < open 长度，
//     fence 内不会出现嵌套 open / 满足长度的 close。
//
// 本函数供 verifyOutput 复用（单一事实来源），export 供单元测试直接断言。
//
// @param {string} mdText answers.md 全文
// @returns {number} fence 之外的答案帧数
export function countMarkdownAnswerFrames(mdText) {
  const FENCE_OPEN_RE = /^(`{3,})([^`]*)$/;
  const FENCE_CLOSE_RE = /^(`{3,})\s*$/;
  const FRAME_RE = /^## \d+\./;
  let count = 0;
  let fenceLen = null; // 当前 open fence 长度；null = 不在 fence 内
  for (const line of mdText.split('\n')) {
    const open = line.match(FENCE_OPEN_RE);
    const close = line.match(FENCE_CLOSE_RE);
    if (fenceLen === null) {
      // 3+ backtick 行（纯 backtick 或带 lang）开启 fence
      if (open !== null) fenceLen = open[1].length;
    } else if (close !== null && close[1].length >= fenceLen) {
      // close 长度必须 ≥ open 长度（CommonMark）；renderer 自适应 fence 下
      // fence 内不会出现满足条件的行，此处只在真实配对处触发
      fenceLen = null;
    }
    if (fenceLen === null && FRAME_RE.test(line)) count += 1;
  }
  return count;
}

export function verifyOutput(questionDir) {
  const dir = path.resolve(questionDir);
  const basename = path.basename(dir);
  const jsonFile = path.join(dir, 'answers.json');
  const mdFile = path.join(dir, 'answers.md');
  const progressFile = path.join(dir, '.progress.json');

  const result = {
    valid: true,
    questionId: basename,
    jsonQuestionId: null,
    done: false,
    answers: 0,
    capturedAnswerCount: 0,
    reportedAnswerCount: null,
    countMismatch: false,
    duplicates: 0,
    jsonValid: false,
    markdownPresent: false,
    warnings: [],
  };

  const fail = (message) => {
    result.valid = false;
    result.warnings.push(message);
  };

  // 1. 输出目录存在
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail('输出目录不存在');
    return result;
  }

  // 2. answers.json 可解析
  let parsed = null;
  if (fs.existsSync(jsonFile)) {
    try {
      parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      result.jsonValid = true;
    } catch (error) {
      fail(`answers.json 无法解析: ${error.message}`);
    }
  } else {
    fail('answers.json 不存在');
  }

  if (parsed !== null) {
    // 14b. canonical 形态：raw-array 只能作为历史读取格式（loadExistingAnswers 兼容），
    //      不能升级为 verified / handoff —— verified 产物必须携带 questionId（三方一致前提）。
    if (Array.isArray(parsed)) {
      fail('answers.json 为历史 raw-array 格式（缺少 questionId 元信息），不能作为 canonical 产物验证；请重新抓取生成 { questionId, answers } 形态');
    }
    // 14. 三方一致（目录侧）：answers.json.questionId 必须与输出目录名一致
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      result.jsonQuestionId = parsed.questionId !== undefined ? String(parsed.questionId) : null;
      if (result.jsonQuestionId === null) {
        fail('answers.json 缺少 questionId 字段');
      } else if (result.jsonQuestionId !== basename) {
        fail(`输出目录 ${basename} 与 answers.json.questionId ${result.jsonQuestionId} 不一致（目录被改名或 JSON 错配）`);
      }
    }
    // 3. answers 是数组
    const answers = Array.isArray(parsed) ? parsed : parsed.answers;
    if (!Array.isArray(answers)) {
      fail('answers 不是数组');
    } else {
      result.answers = answers.length;
      // 8. captured vs reported（warning/metadata，不设失败门）
      result.capturedAnswerCount = answers.length;
      const reported = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed.reportedAnswerCount ?? parsed.answerCount ?? parsed.total ?? null)
        : null;
      result.reportedAnswerCount = reported === null ? null : Number(reported);
      if (result.reportedAnswerCount !== null
        && Number.isFinite(result.reportedAnswerCount)
        && result.reportedAnswerCount !== answers.length) {
        result.countMismatch = true;
        result.warnings.push(`页面统计 ${result.reportedAnswerCount} 与实际抓取 ${answers.length} 不一致（原因未知，仅提示，不设失败）`);
      }
      // 4. 每条回答 ID 合法
      const badIds = answers.filter((a) => !/^\d{1,20}$/.test(String(a?.id ?? '')));
      if (badIds.length > 0) {
        fail(`${badIds.length} 条回答 ID 非法`);
      }
      // 5. 回答 ID 无重复
      const seen = new Set();
      let duplicates = 0;
      for (const a of answers) {
        const id = String(a?.id ?? '');
        if (seen.has(id)) duplicates += 1;
        seen.add(id);
      }
      result.duplicates = duplicates;
      if (duplicates > 0) {
        fail(`${duplicates} 条重复回答 ID`);
      }
    }
  }

  // 6+7. .progress.json 可解析 且 done === true
  if (fs.existsSync(progressFile)) {
    try {
      const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      result.done = progress.done === true;
      if (!result.done) {
        fail('断点状态 done !== true（可能未完成或存在中途失败）');
      }
    } catch (error) {
      fail(`.progress.json 无法解析: ${error.message}`);
    }
  } else {
    fail('.progress.json 不存在');
  }

  // 9. Markdown 文件存在
  if (fs.existsSync(mdFile)) {
    const mdText = fs.readFileSync(mdFile, 'utf8');
    if (mdText.trim().length === 0) {
      fail('answers.md 为空文件');
    } else {
      result.markdownPresent = true;
      // 10. Markdown 与 JSON 记录数一致（F1：fence-aware 计数，跳过 fenced code 内假匹配）
      const mdCount = countMarkdownAnswerFrames(mdText);
      if (result.answers > 0 && mdCount !== result.answers) {
        fail(`Markdown 记录数 ${mdCount} 与 JSON 记录数 ${result.answers} 不一致`);
      }
    }
  } else {
    fail('answers.md 不存在');
  }

  // 11. 输出不是空文件
  if (result.answers === 0) {
    fail('输出为空（0 条回答）');
  }

  // 12. 无损坏状态文件（.corrupt-* 备份或损坏残留）
  const corruptFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'))
    : [];
  if (corruptFiles.length > 0) {
    fail(`存在损坏状态备份文件: ${corruptFiles.join(', ')}`);
  }

  // 13. 无中途失败标记
  if (parsed !== null && typeof parsed === 'object' && parsed.failed === true) {
    fail('产物包含失败标记');
  }

  return result;
}
