#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveSecret, ConfigError } from './config.js';
import { grabAll, normalizeQuestionInput } from './grabber.js';
import { renderAnswers } from './render.js';
import { searchQuestions, extractQuestionId } from './official.js';

const HELP = `zhigrab — 知乎回答抓取工具（用你自己的 zhihu-cli 登录态）

用法:
  zhigrab grab <问题链接或ID>        抓取单个问题的全部回答（支持断点续传）
  zhigrab batch <file.txt>           每行一个问题链接/ID，批量顺序抓取
  zhigrab search <关键词> [--grab]   用官方开放平台搜索问题；--grab 直接抓第一个结果
  zhigrab status                     查看 out/ 下已抓取的内容

配置（Cookie 来源，任选其一）:
  1) 环境变量 ZHIHU_COOKIE = 浏览器里复制的一整串 cookie
  2) 当前目录 zhihu_cookie.txt（里面放一整串 cookie）
  3) ~/.zhihu-cli/config.json（zhihu-cli 登录产物）
Access Secret:  环境变量 ZHIHU_SECRET 或当前目录 zhihu_secret.txt（search 需要）

输出:
  out/<问题ID>/answers.json  结构化回答
  out/<问题ID>/answers.md    可读 Markdown
`;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function cmdGrab(config, input, { outDir = 'out' } = {}) {
  const qid = normalizeQuestionInput(input);
  log(`▶ 开始抓取问题 ${qid} …`);
  const result = await grabAll(config, qid, {
    outDir,
    onProgress: (p) => {
      if (p.event === 'page') {
        log(`  第 ${p.page} 页 offset=${p.offset} 新增 ${p.fetched} 条，累计 ${p.total} 条${p.isEnd ? '（已到末尾）' : ''}`);
      } else if (p.event === 'start' && p.resumeOffset > 0) {
        log(`  ↻ 断点续传：从 offset=${p.resumeOffset} 继续（已有 ${p.existing} 条）`);
      }
    },
  });
  const md = renderAnswers(result, result.answers);
  const dir = path.join(outDir, qid);
  fs.writeFileSync(path.join(dir, 'answers.md'), md, 'utf8');
  log(`✓ 完成：问题「${result.questionTitle || qid}」共抓取 ${result.answers.length} 条回答`);
  log(`  JSON: ${path.join(dir, 'answers.json')}`);
  log(`  MD  : ${path.join(dir, 'answers.md')}`);
}

async function cmdBatch(config, file) {
  if (!fs.existsSync(file)) throw new Error(`批量文件不存在: ${file}`);
  const inputs = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (inputs.length === 0) throw new Error('批量文件为空');
  log(`▶ 批量抓取 ${inputs.length} 个问题`);
  for (const [i, input] of inputs.entries()) {
    log(`\n[${i + 1}/${inputs.length}] ${input}`);
    try {
      await cmdGrab(config, input);
    } catch (error) {
      log(`  ✗ 抓取失败: ${error.message}（已跳过，可稍后重跑续传）`);
    }
  }
  log('\n✓ 批量任务结束');
}

async function cmdSearch(keyword, { grab } = {}) {
  const secret = resolveSecret();
  log(`▶ 官方平台搜索「${keyword}」…`);
  const items = await searchQuestions(keyword, secret);
  const questions = items
    .map((it) => ({ id: extractQuestionId(it), title: it.Title, type: it.ContentType }))
    .filter((it) => it.id);
  if (questions.length === 0) {
    log('未找到相关问题');
    return;
  }
  const unique = [...new Map(questions.map((q) => [q.id, q])).values()];
  log(`找到 ${unique.length} 个相关话题/问题：`);
  unique.slice(0, 10).forEach((q, i) => log(`  ${i + 1}. [${q.type}] ${q.title}\n     ID=${q.id}  https://www.zhihu.com/question/${q.id}`));
  if (grab) {
    const first = unique[0];
    log(`\n--grab 已指定，抓取第一个结果（ID=${first.id}）…`);
    const config = loadConfig();
    await cmdGrab(config, first.id);
  }
}

async function cmdStatus(outDir = 'out') {
  if (!fs.existsSync(outDir)) {
    log('还没有任何抓取产物（out/ 不存在）');
    return;
  }
  const dirs = fs.readdirSync(outDir).filter((d) => /^\d+$/.test(d));
  if (dirs.length === 0) {
    log('out/ 为空，暂无产物');
    return;
  }
  log(`已抓取 ${dirs.length} 个问题：`);
  for (const d of dirs) {
    const jsonFile = path.join(outDir, d, 'answers.json');
    let count = 0;
    if (fs.existsSync(jsonFile)) {
      const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      count = Array.isArray(parsed) ? parsed.length : (parsed.answers?.length ?? 0);
    }
    const progress = fs.existsSync(path.join(outDir, d, '.progress.json'))
      ? JSON.parse(fs.readFileSync(path.join(outDir, d, '.progress.json'), 'utf8'))
      : {};
    log(`  ${d}  回答 ${count} 条  ${progress.done ? '已完成' : `进行中(offset=${progress.offset ?? 0})`}`);
  }
}

async function main() {
  const [cmd, arg1, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return;
  }
  try {
    if (cmd === 'grab') {
      if (!arg1) throw new Error('grab 需要一个参数：问题链接或 ID');
      const config = loadConfig();
      await cmdGrab(config, arg1);
    } else if (cmd === 'batch') {
      if (!arg1) throw new Error('batch 需要一个参数：批量文件路径');
      const config = loadConfig();
      await cmdBatch(config, arg1);
    } else if (cmd === 'search') {
      if (!arg1) throw new Error('search 需要一个参数：关键词');
      await cmdSearch(arg1, { grab: rest.includes('--grab') });
    } else if (cmd === 'status') {
      await cmdStatus();
    } else {
      throw new Error(`未知命令: ${cmd}`);
    }
  } catch (error) {
    process.stderr.write(`\n✗ ${error.message}\n`);
    if (error instanceof ConfigError) {
      process.stderr.write('  提示：先在本机完成 zhihu-cli 登录（zhihu-cli login --qrcode）。\n');
    }
    process.exitCode = 1;
  }
}

main();
