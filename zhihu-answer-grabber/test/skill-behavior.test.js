import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const REF_DIR = path.join(SKILL_DIR, 'references');

function readSkill() {
  return fs.readFileSync(SKILL_MD, 'utf8');
}

function readFrontmatterDescription() {
  const text = readSkill();
  const m = text.match(/^description:\s*(.+)$/m);
  assert.ok(m, 'SKILL.md 必须包含 description frontmatter');
  return m[1];
}

// ===== 触发边界 eval（正例 / 反例） =====

/** 模拟触发判定：检查 description 是否覆盖意图（关键词级近似，用于回归测试） */
function wouldTrigger(description, userIntent) {
  const positive = description;
  // 反例意图中出现"不应触发"信号时不得触发
  const negativeSignals = ['讨论', '粘贴', '总结正文', '一般知识', '点赞', '评论', '关注', '登录'];
  const hasNegative = negativeSignals.some((s) => userIntent.includes(s));
  if (hasNegative) return false;
  const intentHasQuestionId = /question\/\d+|\b\d{1,20}\b/.test(userIntent);
  const intentHasSearchOrGrab = /抓|搜|批量|爬|下载|获取/.test(userIntent);
  const descriptionCovers = positive.includes('抓取') || positive.includes('搜索');
  return (intentHasQuestionId || intentHasSearchOrGrab) && descriptionCovers;
}

const POSITIVE_INTENTS = [
  '抓取 https://www.zhihu.com/question/123 的全部回答',
  '批量抓取这三个知乎问题 ID',
  '搜索知乎上的"浏览器词典插件"，列出候选问题',
];

const NEGATIVE_INTENTS = [
  '知乎上有人说 AI 会替代产品经理，你怎么看？',
  '总结我下面粘贴的知乎回答',
  '知乎是什么公司？',
  '帮我写一篇关于知乎的文章',
];

test('description regression：正例应触发（关键词模拟，非真实 runtime）', () => {
  const description = readFrontmatterDescription();
  for (const intent of POSITIVE_INTENTS) {
    assert.equal(wouldTrigger(description, intent), true, `正例未触发: ${intent}`);
  }
});

test('description regression：反例不应触发（关键词模拟，非真实 runtime）', () => {
  const description = readFrontmatterDescription();
  for (const intent of NEGATIVE_INTENTS) {
    assert.equal(wouldTrigger(description, intent), false, `反例误触发: ${intent}`);
  }
});

test('description 包含明确不应触发边界', () => {
  const description = readFrontmatterDescription();
  assert.ok(/不用于/.test(description), 'description 应含"不用于"负面边界');
  assert.ok(!/codex有哪些奇技淫巧/.test(description), '不得包含具体私人问题标题');
});

// ===== 凭据安全 =====

test('SKILL.md 不得要求用户提供 Cookie', () => {
  const text = readSkill();
  // 允许"绝不要求用户……粘贴"的禁止性表述；不得出现正面指令（请/让用户提供、粘贴 Cookie）
  assert.ok(!/(请|让|叫|要求?)用户[^。]{0,20}(提供|粘贴)/.test(text.replace(/绝不要求用户/g, '')), 'SKILL 不得正面要求用户提供/粘贴凭据');
  assert.ok(!/F12/.test(text), 'SKILL 不得引导 F12 复制 cookie 粘贴');
});

test('SKILL.md 不得写死 Clash/端口/IP', () => {
  const text = readSkill();
  assert.ok(!/7897|Clash|美国数据中心|住宅 IP/.test(text), 'SKILL 不得包含个人网络环境配置');
});

test('SKILL.md 不得武断归因折叠回答', () => {
  const text = readSkill();
  // 只允许"不得使用……"的禁止性说明；不允许正面断言"其余一定是被折叠"或"属正常"
  const cleaned = text.replace(/不得使用[^。]*。+/g, ''); // 移除禁止性说明本身
  assert.ok(!/其余[^。]*被折叠/.test(cleaned), 'SKILL 不得正面断言回答被折叠');
  assert.ok(!/属正常|接口侧不可见/.test(cleaned), 'SKILL 不得把不一致断言为正常');
});

test('SKILL.md 必须引用产物验证脚本', () => {
  const text = readSkill();
  assert.ok(/verify-output\.mjs/.test(text), 'SKILL 必须引用 verify-output.mjs');
  assert.ok(/preflight\.mjs/.test(text), 'SKILL 必须引用 preflight.mjs');
});

test('SKILL.md 必须声明只读操作边界', () => {
  const text = readSkill();
  assert.ok(/只做读取操作|只读/.test(text));
  assert.ok(/不绕过验证码/.test(text));
});

test('SKILL.md 必须包含与 corpus-anthology 的 handoff 指引', () => {
  const text = readSkill();
  assert.ok(/handoff|corpus-anthology/.test(text));
});

test('references 文件齐全', () => {
  for (const f of ['usage.md', 'security.md', 'verification.md', 'handoff-schema.md']) {
    assert.ok(fs.existsSync(path.join(REF_DIR, f)), `缺少 references/${f}`);
  }
});

test('agents/openai.yaml 存在且 allow_implicit_invocation: false', () => {
  const yaml = fs.readFileSync(path.join(SKILL_DIR, 'agents', 'openai.yaml'), 'utf8');
  assert.match(yaml, /allow_implicit_invocation:\s*false/);
  assert.match(yaml, /interface:/);
});

test('frontmatter 兼容 OpenAI allowlist：agent_created 在 metadata 内而非顶层', () => {
  const text = readSkill();
  // 顶层不得有 agent_created（OpenAI 官方 allowlist 只允许 name/description/license/allowed-tools/metadata）
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, 'frontmatter 存在');
  const yaml = fm[1];
  assert.ok(!/^agent_created:/m.test(yaml), 'agent_created 不得在顶层');
  assert.ok(/^\s*agent_created:\s*true/m.test(yaml), 'agent_created 应位于 metadata 下');
  // 顶层允许键集合
  const topKeys = yaml.split('\n')
    .filter((l) => /^[A-Za-z0-9_-]+:/.test(l) && !l.startsWith(' '))
    .map((l) => l.split(':')[0].trim());
  const allowed = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
  for (const k of topKeys) {
    assert.ok(allowed.has(k), `frontmatter 顶层不允许的键: ${k}`);
  }
});

test('npm pack 后 references 目录必须保留（P1-10）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('references'), 'files 白名单必须包含 references');
  assert.ok(pkg.files.includes('agents'), 'files 白名单必须包含 agents');
  // 用 npm pack --dry-run 验证实际 packlist（忽略 prepack 测试脚本）
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: SKILL_DIR,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_yes: 'true' },
  });
  assert.equal(r.status, 0, r.stderr);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (error) {
    assert.fail(`npm pack 输出无法解析: ${r.stdout.slice(0, 200)}`);
  }
  const files = (parsed[0]?.files || []).map((f) => f.path);
  for (const ref of ['usage.md', 'security.md', 'verification.md', 'handoff-schema.md']) {
    assert.ok(files.includes(`references/${ref}`), `pack 中应包含 references/${ref}`);
  }
  for (const f of ['preflight.mjs', 'verify-output.mjs']) {
    assert.ok(files.includes(`scripts/${f}`), `pack 中应包含 scripts/${f}`);
  }
  assert.ok(files.includes('agents/openai.yaml'), 'pack 中应包含 agents/openai.yaml');
});

test('脚本文件存在且可执行', () => {
  for (const f of ['preflight.mjs', 'verify-output.mjs', 'zhigrab.mjs']) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'scripts', f)), `缺少 scripts/${f}`);
  }
});

test('SKILL.md 引用的脚本都存在（含跨模块 corpus-anthology）', () => {
  const text = readSkill();
  const repoRoot = path.resolve(SKILL_DIR, '..');
  const refs = [...text.matchAll(/scripts\/([\w-]+\.mjs)/g)].map((m) => m[1]);
  for (const r of refs) {
    const inLocal = fs.existsSync(path.join(SKILL_DIR, 'scripts', r));
    const inCorpus = fs.existsSync(path.join(repoRoot, 'corpus-anthology', 'scripts', r));
    assert.ok(inLocal || inCorpus, `SKILL 引用不存在的脚本: ${r}`);
  }
});
