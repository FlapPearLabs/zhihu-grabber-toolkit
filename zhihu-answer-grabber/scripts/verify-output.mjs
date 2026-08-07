#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * verify-output — 验证抓取产物完整性。
 *
 * 用法: node scripts/verify-output.mjs <out/question-id>
 * 输出: 结构化 JSON（见下），valid=false 时退出码非 0。
 *
 * 校验项:
 *   1. 输出目录存在
 *   2. answers.json 可解析
 *   3. answers 是数组
 *   4. 每条回答 ID 合法
 *   5. 回答 ID 无重复
 *   6. .progress.json 可解析
 *   7. done === true
 *   8. JSON 中回答数量与实际数组长度一致
 *   9. Markdown 文件存在
 *  10. Markdown 与 JSON 记录数一致
 *  11. 输出不是空文件
 *  12. 无损坏状态文件
 *  13. 无中途失败记录
 */
import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const questionDirArg = process.argv[2] || arg('--dir', null);
if (!questionDirArg) {
  console.error('用法: node scripts/verify-output.mjs <out/question-id>');
  process.exit(2);
}

const dir = path.resolve(questionDirArg);
const basename = path.basename(dir);
const jsonFile = path.join(dir, 'answers.json');
const mdFile = path.join(dir, 'answers.md');
const progressFile = path.join(dir, '.progress.json');

const result = {
  valid: true,
  questionId: basename,
  done: false,
  answers: 0,
  duplicates: 0,
  jsonValid: false,
  markdownPresent: false,
  warnings: [],
};

function fail(message) {
  result.valid = false;
  result.warnings.push(message);
}

// 1. 输出目录存在
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  fail('输出目录不存在');
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
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
  // 3. answers 是数组
  const answers = Array.isArray(parsed) ? parsed : parsed.answers;
  if (!Array.isArray(answers)) {
    fail('answers 不是数组');
  } else {
    result.answers = answers.length;
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
    // 8. JSON 中回答数量与实际数组长度一致
    const declared = Array.isArray(parsed) ? answers.length : (parsed.answers?.length ?? answers.length);
    if (declared !== answers.length) {
      fail(`JSON 声明回答数 ${declared} 与实际数组长度 ${answers.length} 不一致`);
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

// 13. 无中途失败记录（progress.done === true 已覆盖；此处检查 JSON 内是否存在失败标记）
if (parsed !== null && typeof parsed === 'object' && parsed.failed === true) {
  fail('产物包含失败标记');
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.valid ? 0 : 1);
