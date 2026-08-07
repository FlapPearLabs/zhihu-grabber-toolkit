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
      // 10. Markdown 与 JSON 记录数一致
      const mdCount = (mdText.match(/^## \d+\./gm) || []).length;
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
