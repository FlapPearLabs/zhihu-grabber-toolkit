#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveSecret, ConfigError } from './config.js';
import { grabAll, normalizeQuestionInput } from './grabber.js';
import { renderAnswers } from './render.js';
import { searchQuestions, extractQuestionId } from './official.js';
import { verifyOutput } from './verifier.js';
import { machineArtifacts } from './machine-paths.js';

const HELP = `zhigrab — 知乎回答抓取工具（用你自己的 zhihu-cli 登录态）

用法:
  zhigrab grab <问题链接或ID> [--comments] [--out-dir <dir>]  抓取单个问题的全部回答（支持断点续传）；--comments 追加 Top3 一级热评（默认关闭）
  zhigrab batch <file.txt> [--out-dir <dir>]     每行一个问题链接/ID，批量顺序抓取
  zhigrab search <关键词> [--grab]               用官方开放平台搜索问题；--grab 直接抓第一个结果（人类模式）
  zhigrab status [--out-dir <dir>]               查看产物目录下的抓取与验收状态

通用选项:
  --json            机器可读输出（stdout 只输出单个 JSON 文档，不混入人类日志）
  --out-dir <dir>   产物目录（默认 ./out），与凭据目录 ZAG_CONFIG_DIR、cwd 三者解耦

配置（Cookie 来源，任选其一）:
  1) 环境变量 ZHIHU_COOKIE = 浏览器里复制的一整串 cookie
  2) 凭据目录 zhihu_cookie.txt（默认当前目录，可用 ZAG_CONFIG_DIR 指定）
  3) ~/.zhihu-cli/config.json（zhihu-cli 登录产物）
Access Secret:  环境变量 ZHIHU_SECRET 或凭据目录 zhihu_secret.txt（search 需要）

状态语义:
  captured     抓取阶段结束（产物已写入，但尚未验收）
  verified     通过 verify-output.mjs 完整验收（唯一事实门）
  grab 从不自行声称 verified；只有 verify-output 可以授予。

输出:
  out/<问题ID>/answers.json  结构化回答
  out/<问题ID>/answers.md    可读 Markdown
`;

/** 移除终端控制字符（ANSI 注入防护） */
function terminalSafe(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

/** 解析命令行：提取 --json / --comments / --out-dir，返回结构化参数 */
function parseArgs(argv) {
  const json = argv.includes('--json');
  const comments = argv.includes('--comments');
  const positional = [];
  let outDir = 'out';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json' || a === '--comments') continue;
    if (a === '--out-dir') {
      outDir = argv[i + 1] || 'out';
      i += 1;
      continue;
    }
    if (a.startsWith('--out-dir=')) {
      outDir = a.slice('--out-dir='.length) || 'out';
      continue;
    }
    positional.push(a);
  }
  return { json, comments, outDir, positional };
}

/** 输出单个 JSON 文档到 stdout（机器契约） */
function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** 错误分类：稳定可识别的结构化 error.type */
function classifyError(error) {
  if (error instanceof ConfigError) return error.errorType ?? 'configuration_error';
  if (error && error.name === 'QuestionMetadataIdentityError') return 'question_metadata_identity_conflict';
  if (error && error.name === 'HttpError') return 'http_error';
  if (error instanceof TypeError) return 'invalid_input';
  if (error && error.invalidInput === true) return 'invalid_input';
  if (error && /网络|fetch|超时|timeout/i.test(error.message)) return 'network_error';
  return 'unknown_error';
}

async function cmdGrab(config, input, { outDir = 'out', json = false, silent = false, comments = false } = {}) {
  let qid;
  try {
    qid = normalizeQuestionInput(input);
  } catch (error) {
    error.invalidInput = true; // 非法问题输入 → 稳定分类 invalid_input
    throw error;
  }
  if (!json && !silent) log(`▶ 开始抓取问题 ${qid} …`);
  // V2 Phase 3（P1-2/P1-3/P1-NEW-2 re-review）：metadata 失败必须用户可见，但
  // **公开 warning 不得转发 raw error**。p.error 可能包含 Cookie / Secret /
  // 服务器 parsed.message / URL / 长外部文本 / 多行注入（requestJson 会把外部
  // 字符串拼进 error.message），而 sanitizeDisplayPaths 只脱敏路径、不处理
  // 凭据与服务器正文。因此公开面固定为确定性最小文本；内部 metadata_failed
  // 事件保留原样（如现有内部诊断需要，不扩 scope）。
  // V2 Phase 4（Spec §15.5）：comments failure 同样只产生 question-level 聚合 warning，
  // 即使多个 selected answer 失败也只提示一次；不转发 raw error / 正文 / 用户数据。
  const warnings = [];
  let commentsWarningEmitted = false;
  const result = await grabAll(config, qid, {
    outDir,
    comments,
    onProgress: (p) => {
      if (p.event === 'metadata_failed') {
        const warning = '本次问题元信息获取/刷新失败；回答核心抓取继续。';
        warnings.push(warning);
        if (!json && !silent) log(`  ⚠ ${warning}`);
        return;
      }
      if (p.event === 'comments_failed') {
        if (commentsWarningEmitted) return; // question-level aggregate，仅提示一次
        commentsWarningEmitted = true;
        const warning = '部分评论 enrichment 获取失败；回答核心抓取继续。';
        warnings.push(warning);
        if (!json && !silent) log(`  ⚠ ${warning}`);
        return;
      }
      if (json || silent) return; // 机器模式不输出逐页进度
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

  // B-1 CROSS_VOLUME_MACHINE_PATH_DISCLOSURE（Product Behavior Contract §3.3
  // APPROVED_TARGET_BEHAVIOR OPTION A）：机器 artifact 路径绝不绝对；
  // 同盘 relative-to-cwd（base 缺席，JSON 与旧版逐字节一致）；
  // 跨盘 relative-to-effective-out-dir + artifacts.base="outdir"。
  // fail closed：无法生成安全相对路径时抛错，绝不输出绝对路径。
  const artifacts = machineArtifacts(dir, {
    cwd: process.cwd(),
    outDirRoot: path.resolve(process.cwd(), outDir),
  });
  if (!artifacts) {
    throw new Error('internal_error: 无法为产物生成安全的相对机器路径（fail closed）');
  }

  // 语义：capture stage finished，artifact verification pending（绝不声称 verified）
  const payload = {
    schemaVersion: 1,
    ok: true,
    command: 'grab',
    stage: 'captured',
    questionId: qid,
    questionTitle: result.questionTitle || '',
    capturedAnswerCount: result.answers.length,
    artifacts,
    verified: false,
    warnings,
  };
  if (json) {
    emitJson(payload);
  } else if (!silent) {
    const baseLabel = payload.artifacts.base === 'outdir' ? '（相对 --out-dir）' : '';
    log(`✓ 抓取阶段结束：问题「${terminalSafe(result.questionTitle || qid)}」已写入 ${result.answers.length} 条回答`);
    log('  产物状态：尚未验证（请运行 node scripts/verify-output.mjs <目录>）');
    log(`  JSON${baseLabel}: ${payload.artifacts.json}`);
    log(`  MD${baseLabel}  : ${payload.artifacts.markdown}`);
  }
  return payload;
}

async function cmdBatch(config, file, { outDir = 'out', json = false, inputs = null } = {}) {
  // main 已用 readBatchInputs 做静态校验（先于凭据检查）；此处兼容直接调用时自行读取
  const batchInputs = inputs ?? readBatchInputs(file);
  if (!json) log(`▶ 批量抓取 ${batchInputs.length} 个问题`);

  const succeeded = [];
  const failed = [];
  for (const [i, input] of batchInputs.entries()) {
    const displayInput = sanitizeDisplayPaths(terminalSafe(input)); // P1-1: input 也走公共清理
    if (!json) log(`\n[${i + 1}/${batchInputs.length}] ${displayInput}`);
    try {
      const p = await cmdGrab(config, input, { outDir, json: false, silent: true });
      succeeded.push(p);
      // V2 Phase 3（P1-2 re-review）：human batch 模式必须让 metadata warning 用户可见。
      // cmdGrab 在 silent 时不打印，由 batch 在成功后统一补打印（warnings 已收集进 p）。
      // 复用同一 warning surface，不建新框架；JSON batch 已通过 succeeded[].warnings 暴露。
      if (!json && Array.isArray(p.warnings) && p.warnings.length > 0) {
        for (const w of p.warnings) log(`  ⚠ ${w}`);
      }
    } catch (error) {
      failed.push({
        input: displayInput,
        errorType: classifyError(error),
        message: publicErrorMessage(error), // P1-INT-NEW-1: 机器通道不泄漏绝对路径
      });
      if (!json) log(`  ✗ 抓取失败: ${terminalSafe(error.message)}（已跳过，可稍后重跑续传）`);
    }
  }

  const payload = {
    schemaVersion: 1,
    ok: failed.length === 0,
    command: 'batch',
    succeeded,
    failed,
  };
  if (json) {
    emitJson(payload);
  } else if (failed.length > 0) {
    log(`\n✗ 批量抓取阶段结束：成功 ${succeeded.length}，失败 ${failed.length}`);
  } else {
    log(`\n✓ 批量抓取阶段结束：成功 ${succeeded.length}，失败 0`);
  }
  return payload;
}

async function cmdSearch(keyword, { grab = false, json = false, outDir = 'out' } = {}) {
  const secret = resolveSecret();
  if (!json) log(`▶ 官方平台搜索「${terminalSafe(keyword)}」…`);
  const items = await searchQuestions(keyword, secret);
  const questions = items
    .map((it) => ({ id: extractQuestionId(it), title: it.Title, type: it.ContentType }))
    .filter((it) => it.id);
  if (questions.length === 0) {
    if (json) {
      emitJson({ schemaVersion: 1, ok: true, command: 'search', query: keyword, candidates: [] });
    } else {
      log('未找到相关问题');
    }
    return { candidates: [] };
  }
  const unique = [...new Map(questions.map((q) => [q.id, q])).values()].slice(0, 10);
  const candidates = unique.map((q) => ({
    questionId: q.id,
    title: terminalSafe(q.title),
    contentType: q.type,
    url: `https://www.zhihu.com/question/${q.id}`,
  }));
  if (json) {
    emitJson({ schemaVersion: 1, ok: true, command: 'search', query: keyword, candidates });
    return { candidates };
  }
  log(`找到 ${unique.length} 个相关话题/问题：`);
  unique.forEach((q, i) => log(`  ${i + 1}. [${terminalSafe(q.type)}] ${terminalSafe(q.title)}\n     ID=${q.id}  https://www.zhihu.com/question/${q.id}`));
  if (grab) {
    const first = unique[0];
    log(`\n--grab 已指定（人类模式），抓取第一个结果（ID=${first.id}）…`);
    const config = loadConfig();
    await cmdGrab(config, first.id, { outDir }); // P2-1: 透传 --out-dir
  }
  return { candidates };
}

async function cmdStatus({ outDir = 'out', json = false } = {}) {
  const items = [];
  if (fs.existsSync(outDir)) {
    const dirs = fs.readdirSync(outDir).filter((d) => /^\d+$/.test(d));
    for (const d of dirs) {
      const dir = path.join(outDir, d);
      const item = { questionId: d };
      try {
        // 抓取阶段状态：progress.done 只表示分页循环结束，不等于验收通过
        const progressFile = path.join(dir, '.progress.json');
        let captureStatus = 'in_progress';
        if (fs.existsSync(progressFile)) {
          try {
            const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
            captureStatus = progress.done === true ? 'captured' : 'in_progress';
          } catch {
            captureStatus = 'in_progress';
          }
        }
        // 回答数：从 answers.json 读取（不依赖 verifier）
        let capturedAnswerCount = null;
        const jsonFile = path.join(dir, 'answers.json');
        if (fs.existsSync(jsonFile)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
            const answers = Array.isArray(parsed) ? parsed : parsed.answers;
            capturedAnswerCount = Array.isArray(answers) ? answers.length : 0;
          } catch { /* 损坏目录不崩溃，capturedAnswerCount 保持 null */ }
        }
        item.capturedAnswerCount = capturedAnswerCount;
        item.captureStatus = captureStatus;
        // 验收状态：captured 的产物才执行 verifier（唯一事实门），in_progress 一律 unverified
        let verificationStatus = 'unverified';
        let verificationWarnings = [];
        if (captureStatus === 'captured') {
          try {
            const v = verifyOutput(dir);
            verificationStatus = v.valid ? 'valid' : 'invalid';
            verificationWarnings = v.warnings;
          } catch (error) {
            verificationStatus = 'invalid';
            verificationWarnings = [`验证执行失败: ${terminalSafe(error.message)}`];
          }
        }
        item.verificationStatus = verificationStatus;
        if (verificationWarnings.length > 0) item.verificationWarnings = verificationWarnings;
      } catch (error) {
        // 单个目录异常不影响整个 status
        item.captureStatus = 'in_progress';
        item.verificationStatus = 'unverified';
        item.verificationWarnings = [`状态读取失败: ${terminalSafe(error.message)}`];
      }
      items.push(item);
    }
  }

  const payload = { schemaVersion: 1, ok: true, command: 'status', items };
  if (json) {
    emitJson(payload);
  } else {
    if (items.length === 0) {
      log('还没有任何抓取产物（out/ 不存在或为空）');
      return payload;
    }
    const label = (s) => ({ in_progress: '进行中', captured: '已结束' }[s] ?? s);
    const vlabel = (s) => ({ unverified: '未执行', valid: '通过', invalid: '未通过' }[s] ?? s);
    log(`已抓取 ${items.length} 个问题：`);
    for (const it of items) {
      log(`  ${it.questionId}`);
      log(`    抓取阶段：${label(it.captureStatus)}`);
      log(`    产物验收：${vlabel(it.verificationStatus)}`);
      log(`    回答：${it.capturedAnswerCount ?? '未知'}`);
    }
  }
  return payload;
}

/** 参数校验错误：归入 invalid_input 类型 */
function invalidInput(message) {
  const error = new Error(message);
  error.invalidInput = true;
  return error;
}

/** 解析并静态校验问题输入（先于凭据检查，保证 invalid_input 不依赖凭据状态） */
function parseQuestionId(input) {
  try {
    return normalizeQuestionInput(input);
  } catch (error) {
    error.invalidInput = true;
    throw error;
  }
}

/** 读取并静态校验 batch 文件（存在 + 非空；先于凭据检查） */
function readBatchInputs(file) {
  if (!fs.existsSync(file)) {
    throw invalidInput(`批量文件不存在: ${sanitizeDisplayPaths(terminalSafe(file))}`);
  }
  const inputs = fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (inputs.length === 0) throw invalidInput('批量文件为空');
  return inputs;
}

/**
 * 从展示文本中抹掉任意本机绝对路径（机器输出防泄漏）；人类 stderr 保留完整诊断。
 *
 * 策略：先提取并占位所有 http(s) URL（避免误伤 https:// 后的路径段），
 * 再对剩余文本脱敏 Windows（盘符）与 POSIX（/ 开头）绝对路径，最后还原 URL。
 * 不再维护 POSIX 根目录白名单（/workspace、/custom、/app 等任意根均覆盖）。
 */
function sanitizeDisplayPaths(value) {
  const urls = [];
  let out = String(value).replace(/https?:\/\/[^\s;,)\]}"']+/g, (m) => {
    urls.push(m);
    return `\u0000URL${urls.length - 1}\u0000`;
  });
  // Windows 绝对路径: C:\Users\... 或 C:/Users/...
  out = out.replace(/(?<![\w:/])([A-Za-z]:[\\/][^\s;,)\]}"']+)/g, '<path>');
  // POSIX 绝对路径: 以 / 开头（前面不是字母数字/冒号/斜杠，排除 URL 与相对路径段）
  out = out.replace(/(?<![\w:/])\/[^\s;,)\]}"']+/g, '<path>');
  // 还原 URL
  out = out.replace(/\u0000URL(\d+)\u0000/g, (_, i) => urls[Number(i)]);
  return out;
}

/** 机器输出使用的公共错误消息：ConfigError 不给内部诊断细节，只引导 preflight */
function publicErrorMessage(error) {
  if (error instanceof ConfigError) {
    return '本地凭据配置不可用；请运行 preflight.mjs --json 查看错误类型，并按提示在本机修复。';
  }
  return sanitizeDisplayPaths(terminalSafe(error.message));
}

async function main() {
  const { json, comments, outDir, positional } = parseArgs(process.argv.slice(2));
  const [cmd, arg1, ...rest] = positional;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return;
  }
  try {
    // V2 Phase 4（Spec §15.8）：--comments 只允许 command = grab。
    // batch / search / status + --comments → 静态 invalid_input，先于 loadConfig /
    // resolveSecret / 任何网络访问 / capture side effect；不产生任何 comments 请求。
    if (comments && cmd !== 'grab') {
      throw invalidInput('--comments 仅支持 grab 命令');
    }
    if (cmd === 'grab') {
      if (!arg1) throw invalidInput('grab 需要一个参数：问题链接或 ID');
      const qid = parseQuestionId(arg1); // 静态校验先于凭据检查（P1-2）
      const config = loadConfig();
      await cmdGrab(config, qid, { outDir, json, comments });
    } else if (cmd === 'batch') {
      if (!arg1) throw invalidInput('batch 需要一个参数：批量文件路径');
      const inputs = readBatchInputs(arg1); // 静态校验先于凭据检查（P1-2）
      const config = loadConfig();
      const r = await cmdBatch(config, arg1, { outDir, json, inputs });
      if (r.failed.length > 0) process.exitCode = 1;
    } else if (cmd === 'search') {
      if (!arg1) throw invalidInput('search 需要一个参数：关键词');
      await cmdSearch(arg1, { grab: rest.includes('--grab'), json, outDir });
    } else if (cmd === 'status') {
      await cmdStatus({ outDir, json });
    } else {
      throw invalidInput(`未知命令: ${cmd}`);
    }
  } catch (error) {
    if (json) {
      // 机器输出：公共消息规范化（不泄漏绝对路径；ConfigError 只给引导语）
      emitJson({
        schemaVersion: 1,
        ok: false,
        command: cmd,
        error: {
          type: classifyError(error),
          message: publicErrorMessage(error),
        },
      });
    } else {
      // 人类模式：保留合理诊断，但 ConfigError 仍引导 preflight
      process.stderr.write(`\n✗ ${terminalSafe(error.message)}\n`);
      if (error instanceof ConfigError) {
        process.stderr.write('  配置不可用。请先运行：node scripts/preflight.mjs\n');
        process.stderr.write('  根据 cookie_error / secret_error 在本机修复对应凭据配置（不要粘贴凭据到聊天）。\n');
      }
    }
    process.exitCode = 1;
  }
}

main();
