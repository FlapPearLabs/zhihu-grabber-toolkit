#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * browser-smoke — 用 Playwright 复用本机知乎登录态，对真实抓取产物做浏览器一致性核验。
 *
 * 目的：用真实浏览器打开抽样回答页面，验证 answers.json 里的 id / author / content
 * 与真实页面一致，替代人工浏览器抽查。
 *
 * 用法:
 *   node scripts/browser-smoke.mjs <answers.json> [--sample 5] [--json]
 *
 * 凭据：复用 src/config.js 的 loadConfig()（ZHIHU_COOKIE / ZAG_CONFIG_DIR 下
 *       zhihu_cookie.txt / ~/.zhihu-cli/config.json），不额外要求用户输入。
 * 安全：独立临时 BrowserContext，关闭即销毁；不启用 trace/video/HAR/截图；
 *       机器输出不含任何凭据内容。
 * 节奏：单 Context 单 Page，顺序访问，页间随机等待 2–4s；仅检查抽样条数。
 * 纯函数（可离线测试）见 browser-smoke-core.mjs；playwright 在运行时动态加载，
 * 保证离线测试不依赖浏览器包/网络。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  toPlaywrightCookies,
  normalizeHtmlText,
  collapseWhitespace,
  extractStableFragments,
  contentMatched,
  sampleIndexes,
  normalizeAuthor,
  sleep,
  loadConfig,
  ConfigError,
  classifyAnswerCheck,
  classifyFinalUrl,
  exitCodeForResult,
  parseSampleSize,
} from './browser-smoke-core.mjs';

const ZHI_URL_RE = /\/question\/(\d+)\/answer\/(\d+)/;

/** 打开页面，并对请求 URL 与 redirect 后 finalUrl 做同一信任边界校验 */
async function navigateWithTrust(page, requestedUrl, questionId, answerId) {
  // 请求 URL 必须通过确定性校验，否则拒绝访问（绝不发出浏览器网络请求）
  const reqCheck = classifyAnswerCheck({ url: requestedUrl, id: answerId }, questionId);
  if (!reqCheck.ok) {
    return { ok: false, navigated: false, reason: `untrusted_request_url: ${reqCheck.reason}` };
  }
  await page.goto(reqCheck.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const finalUrl = page.url();
  // redirect 后的 finalUrl 必须通过同一信任边界校验
  const finCheck = classifyFinalUrl(finalUrl, questionId, answerId);
  if (!finCheck.ok) {
    return { ok: false, navigated: true, finalUrl, reason: `final_url_out_of_trust: ${finCheck.reason}` };
  }
  return { ok: true, navigated: true, url: finCheck.url, finalUrl };
}

/** 从当前回答页面提取正文区域文本；无法定位时退化为整页文本（scope=whole_page_fallback） */
async function extractAnswerText(page) {
  const selectors = [
    'div.QuestionAnswer-content',
    'div.QuestionAnswer',
    'div.AnswerItem',
    'div.RichContent-inner',
    'div.RichContent',
    'div.List-item',
  ];
  for (const sel of selectors) {
    const handles = await page.$$(sel).catch(() => []);
    if (handles.length > 0) {
      let best = '';
      for (const h of handles) {
        const t = await h.innerText().catch(() => '');
        if (t && t.length > best.length) best = t;
      }
      if (best && best.length > 80) return { text: best, scope: 'answer_area' };
    }
  }
  const body = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  return { text: body, scope: 'whole_page_fallback' };
}

/** 读取当前页面可见点赞数（仅 observation，不作为 gate） */
async function extractVoteup(page) {
  try {
    const val = await page.evaluate(() => {
      const el = document.querySelector('.VoteButton--up')?.parentElement;
      if (!el) return null;
      const m = el.innerText.match(/(\d[\d,]*)\s*赞同/);
      return m ? Number(m[1].replace(/,/g, '')) : null;
    });
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/** 检查页面是否疑似登录/验证码/错误页（inconclusive 而非 mismatch） */
function looksLikeGatePage(url, title, bodyText) {
  const u = String(url);
  if (/\/login|signin|passport/i.test(u)) return true;
  if (/captcha|verify|security|安全验证|人机验证/i.test(u + ' ' + title)) return true;
  const t = (title || '') + ' ' + String(bodyText || '').slice(0, 400);
  if (/安全验证|请完成验证|验证码|登录后继续/.test(t)) return true;
  // 知乎风控壳：返回 {"error":{"message":"您当前请求存在异常…","code":40362}}
  if (/请求存在异常|暂时限制本次访问|小管家反馈/.test(t)) return true;
  return false;
}

async function runSmoke(answersJsonPath, { sampleSize = 5, json = false } = {}) {
  const answersFile = path.resolve(answersJsonPath);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
  } catch (error) {
    throw new Error(`answers.json 无法解析: ${error.message}`);
  }
  const answers = Array.isArray(parsed) ? parsed : parsed.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    throw new Error('answers 不是非空数组');
  }
  const questionId = parsed.questionId ?? path.basename(path.dirname(answersFile));
  const n = answers.length;
  const indexes = sampleIndexes(n, sampleSize);

  // 凭据：复用 loadConfig()，绝不输出内容
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const reason = error instanceof ConfigError ? 'configuration_error' : 'credential_load_error';
    const payload = {
      ok: false, questionId, sourceAnswerCount: n, sampleSize: indexes.length,
      passed: 0, failed: 0, inconclusive: indexes.length,
      result: 'inconclusive',
      checks: indexes.map((i) => ({
        index: i, answerId: String(answers[i]?.id ?? ''), result: 'inconclusive',
        reason,
      })),
      warnings: ['凭据不可用：' + reason + '（请先运行 preflight 在本机修复）'],
    };
    if (json) {
      process.stdout.write(JSON.stringify(payload) + '\n');
      return payload;
    }
    throw error;
  }

  // playwright 运行时动态加载（离线测试不依赖）
  const { chromium } = await import('@playwright/test');

  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      userAgent: config.userAgent,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies(toPlaywrightCookies(config.cookies || {}));
    const page = await context.newPage();

    const checks = [];
    for (const idx of indexes) {
      const ans = answers[idx];
      const check = {
        index: idx,
        answerId: String(ans?.id ?? ''),
        urlMatched: false,
        authorMatched: false,
        contentMatched: false,
        result: 'inconclusive',
      };
      checks.push(check);

      const reqCheck = classifyAnswerCheck(ans, questionId);
      if (!reqCheck.ok) {
        // P1-A：请求 URL 不在信任边界内 → 拒绝访问，绝不发出浏览器网络请求。
        // answers.json 提供不可信 URL 是产物数据本身的明确反证 → 记 fail。
        check.result = 'fail';
        check.reason = `untrusted_request_url: ${reqCheck.reason}`;
        if (!json) process.stdout.write(`    ✗ 拒绝访问（URL 不在信任边界）: ${reqCheck.reason}\n`);
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }
      if (!json) process.stdout.write(`  #${checks.length} 打开回答 ${ans.id} …\n`);
      let finalUrl = '';
      let title = '';
      let bodyText = '';
      try {
        const nav = await navigateWithTrust(page, reqCheck.url, questionId, String(ans.id));
        finalUrl = nav.finalUrl || '';
        if (!nav.ok) {
          // redirect 后的 finalUrl 不在信任边界 → 绝不视为匹配
          check.reason = nav.reason;
          if (!json) process.stdout.write(`    ✗ ${nav.reason}\n`);
          await sleep(2000 + Math.floor(Math.random() * 2000));
          continue;
        }
        title = await page.title().catch(() => '');
        await page.waitForTimeout(1500); // 等正文渲染
        const extracted = await extractAnswerText(page);
        bodyText = extracted.text;
        check.scope = extracted.scope;
      } catch (error) {
        check.reason = 'page_load_error: ' + String(error.message).split('\n')[0].slice(0, 120);
        if (!json) process.stdout.write(`    ✗ 页面加载失败: ${check.reason}\n`);
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }
      check.finalUrl = finalUrl;
      check.pageTitle = title.slice(0, 80);

      // Check A：gate page → inconclusive
      if (looksLikeGatePage(finalUrl, title, bodyText)) {
        check.reason = 'gate_page（登录/验证码/安全验证/风控壳）';
        if (!json) process.stdout.write(`    ? 疑似 gate page，记 inconclusive\n`);
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }

      // 内容未加载检测：DOM 未渲染（body 过短 / 返回错误 JSON / 无正文区）→ INCONCLUSIVE，
      // 不得据此判 author/content FAIL。典型场景：自动化浏览器触发知乎风控壳（40362）。
      const trimmedBody = String(bodyText || '').trim();
      const looksLikeErrorJson = trimmedBody.startsWith('{') && /"error"\s*:/.test(trimmedBody.slice(0, 200));
      if (trimmedBody.length < 200 || looksLikeErrorJson) {
        check.reason = looksLikeErrorJson
          ? 'page_returns_error_json（疑似浏览器风控，DOM 未加载）'
          : 'page_content_not_loaded（DOM 文本过短，无法核验）';
        check.scope = check.scope || 'whole_page_fallback';
        if (!json) process.stdout.write(`    ? 内容未加载，记 inconclusive\n`);
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }

      // Check B：answer ID 身份（finalUrl 已在信任边界内，此处确认 answerId 匹配）
      const m = String(finalUrl).match(ZHI_URL_RE);
      if (!m || m[2] !== String(ans.id)) {
        check.reason = m ? 'answer_id_mismatch' : 'final_url_not_answer';
        if (!json) process.stdout.write(`    ✗ ${check.reason}\n`);
        await sleep(2000 + Math.floor(Math.random() * 2000));
        continue;
      }
      check.urlMatched = true;

      // Check C：作者一致（优先 answer 区域；退化整页）
      const expectedAuthor = normalizeAuthor(ans.author);
      const authorHit = expectedAuthor && bodyText
        ? collapseWhitespace(bodyText).toLowerCase().includes(expectedAuthor)
        : false;
      check.authorMatched = authorHit;
      check.expectedAuthor = String(ans.author ?? '').slice(0, 40);

      // 正文匹配
      check.contentMatched = contentMatched(ans.content, bodyText);
      check.voteup = { api: ans.voteupCount ?? null, browser: await extractVoteup(page) };

      if (check.urlMatched && check.authorMatched && check.contentMatched) {
        check.result = 'pass';
      } else if (!check.authorMatched || !check.contentMatched) {
        // 页面身份正确，但作者/正文与预期不符 → 明确反证才 FAIL
        check.result = 'fail';
        check.reason = !check.authorMatched ? 'author_mismatch' : 'content_mismatch';
      }
      if (!json) {
        process.stdout.write(`    ${check.result.toUpperCase()}: author=${check.authorMatched ? 'OK' : 'MISS'} content=${check.contentMatched ? 'OK' : 'MISS'} scope=${check.scope}\n`);
      }
      // 页间随机等待 2–4s（低频节奏）
      await sleep(2000 + Math.floor(Math.random() * 2000));
    }

    const passed = checks.filter((c) => c.result === 'pass').length;
    const failed = checks.filter((c) => c.result === 'fail').length;
    const inconclusive = checks.filter((c) => c.result === 'inconclusive').length;
    const result = failed > 0 ? 'fail' : (inconclusive > 0 ? 'inconclusive' : 'pass');
    const payload = {
      ok: true,
      questionId,
      sourceAnswerCount: n,
      sampleSize: checks.length,
      passed,
      failed,
      inconclusive,
      result,
      checks,
      warnings: [],
    };
    if (json) process.stdout.write(JSON.stringify(payload) + '\n');
    return payload;
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function isMain() {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const sampleArgIdx = args.indexOf('--sample');
  const rawSample = sampleArgIdx >= 0 ? args[sampleArgIdx + 1] : undefined;
  const sampleParsed = parseSampleSize(rawSample);
  if (!sampleParsed.ok) {
    // P2：--sample 必须是整数 1-20；超范围 → invalid_input，不开始浏览器访问
    const msg = 'invalid --sample: 必须是 1-20 的整数（默认 5），收到: ' + String(rawSample);
    if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, result: 'inconclusive', invalidInput: true, warnings: [msg] }) + '\n');
    else console.error(`✗ ${msg}`);
    process.exit(2);
  }
  const sampleSize = sampleParsed.value;
  const target = args.find((a) => a && !a.startsWith('--'));
  if (!target) {
    const msg = '用法: node scripts/browser-smoke.mjs <answers.json> [--sample 5] [--json]';
    if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, result: 'inconclusive', warnings: [msg] }) + '\n');
    else console.error(msg);
    process.exit(2);
  }
  try {
    const payload = await runSmoke(target, { sampleSize, json: jsonMode });
    // P1-B：只有 pass 才 exit 0；fail → 1；inconclusive / 运行错误 → 2
    process.exit(exitCodeForResult(payload.result));
  } catch (error) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({
        ok: false, result: 'inconclusive', warnings: ['执行失败: ' + String(error.message).slice(0, 200)],
      }) + '\n');
    } else {
      console.error(`✗ ${error.message}`);
    }
    process.exit(2);
  }
}

if (isMain()) main();
