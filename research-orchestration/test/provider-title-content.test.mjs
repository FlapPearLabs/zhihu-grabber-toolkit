// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { defaultRunner } from '../lib/runner.mjs';
import { createOfficialSearchAdapter } from '../lib/official-search-provider.mjs';
import { rrfFusion, assertArtifactSafe, projectSafeJson, isBoundarySafeString } from '../lib/rrf.mjs';
import { parseBoundProviderPool } from '../lib/provider-title-origin.mjs';
import { createGlobalSearchAdapter } from '../lib/global-search-provider.mjs';
import { createSessionCaptureAdapter } from '../lib/session-capture-provider.mjs';
import { admitTargetedQueryString } from '../lib/targeted-requery-trust.mjs';

const EXTERNAL_TITLE = '研究 /etc/hosts、/usr/local/bin、C:\\Users\\example、../foo、--flag 与 shell/code 文本';

// Substitute only external fetch IO in the real, fixed search CLI. The isolated
// cwd/config and synthetic auth prevent any real credential/config file read.
function officialTitle(title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-content-'));
  try {
    const preload = path.join(dir, 'network.mjs');
    fs.writeFileSync(preload, `globalThis.fetch = async (url) => {
      if (new URL(url).pathname !== '/api/v1/content/zhihu_search') throw new Error('offline IO refused');
      return new Response(${JSON.stringify(JSON.stringify({ Code: 0, Data: { Items: [
        { Url: 'https://www.zhihu.com/question/123', Title: title, ContentType: 'question' },
      ] } }))}, { status: 200 });
    };`);
    const run = defaultRunner();
    const adapter = createOfficialSearchAdapter({ runner: (name, args) => run(name, args, {
      cwd: dir,
      env: {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        ZHIHU_SECRET: 'synthetic-test-only', ZHIHU_COOKIE: '', ZAG_CONFIG_DIR: dir,
        ZHIHU_CLI_CONFIG: path.join(dir, 'absent.json'),
        ZHIHU_CREATOR_CONFIG: path.join(dir, 'absent.json'),
      },
    }) });
    const result = adapter.retrieve({ query: '合成研究' });
    assert.equal(result.ok, true);
    assert.equal(result.items[0].facts.title, title);
    return result;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function fuse(result) {
  return rrfFusion([{ channel: { query: '合成研究', providerId: result.provider_id, capability: 'search' }, items: result.items }]);
}

test('canonical external title remains inert and survives adapter → RRF → artifact walk', () => {
  const result = officialTitle(EXTERNAL_TITLE);
  const fused = fuse(result);
  assert.equal(fused.candidates[0].facts.title, EXTERNAL_TITLE);
  assert.equal(assertArtifactSafe(fused).ok, true);
});

function denied(result) {
  assert.throws(() => fuse(result), { code: 'FUSION_UNSAFE_PROVIDER_DATA' });
}

test('plain JSON, copied receipt, self-reported origin and title mutation do not grant provenance', () => {
  const result = officialTitle(EXTERNAL_TITLE);
  denied(JSON.parse(JSON.stringify(result)));
  const forged = JSON.parse(JSON.stringify(result));
  forged.items[0].facts.origin = 'UNTRUSTED_INERT_CONTENT';
  denied(forged);
  const injected = createOfficialSearchAdapter({ runner: () => ({ status: 0, stdout: JSON.stringify({
    ok: true, candidates: [{ questionId: '123', title: EXTERNAL_TITLE, url: 'https://www.zhihu.com/question/123' }],
  }) }) }).retrieve({ query: '合成研究' });
  denied(injected);
  result.items[0].facts.title = '/etc/hosts changed';
  denied(result);
});

test('title qualification is object, field, identity and provider bound, never a string allowlist', () => {
  const result = officialTitle(EXTERNAL_TITLE);
  result.items[0].facts.metadata = EXTERNAL_TITLE;
  denied(result);
  delete result.items[0].facts.metadata;
  result.items[0].identity.questionId = '124';
  denied(result);
  result.items[0].identity.questionId = '123';
  result.provider_id = 'zhihu-open-platform';
  denied(result);
  assert.equal(projectSafeJson(result.items[0].facts).ok, false);
  assert.equal(assertArtifactSafe({ facts: result.items[0].facts }).ok, false);
});

test('artifact walk rechecks the actual title value after metadata getters, and keeps the original guard', () => {
  const candidate = fuse(officialTitle(EXTERNAL_TITLE)).candidates[0];
  Object.defineProperty(candidate.facts, 'metadata', { enumerable: true, get() {
    candidate.facts.title = '/etc/hosts changed'; return 'ordinary metadata';
  } });
  assert.equal(assertArtifactSafe({ candidates: [candidate] }).ok, false);
});

test('canonical network titles still reject actual private context and credential-shaped text', () => {
  for (const title of [path.join(os.homedir(), '.ssh', 'id_ed25519'),
    `runtime directory ${process.cwd()}/private-state.json`,
    `https://example.com/${encodeURIComponent(path.join(os.homedir(), '.ssh', 'id_ed25519'))}`,
    'API_KEY=synthetic-test-only', 'https://example.com/?token=synthetic-test-only']) {
    denied(officialTitle(title));
  }
});

test('native dot-segment aliases of the actual private home remain fail closed', () => {
  const home = os.homedir().replaceAll('\\', '/');
  const parent = path.dirname(home).replaceAll('\\', '/');
  const user = path.basename(home);
  for (const title of [`${parent}/./${user}/.ssh/id_ed25519`,
    `${parent}/synthetic-sibling/../${user}/.ssh/id_ed25519`,
    `${parent}//./${user}/.ssh/id_ed25519`]) denied(officialTitle(title));
});

test('encoded credential shapes in inert prose remain fail closed at RRF', () => {
  for (const title of ['研究 /etc/hosts 与 token%3Dsynthetic-test-only',
    '研究 /etc/hosts 与 https://example.com/?token%3Dsynthetic-test-only',
    '研究 /etc/hosts 与 token%253Dsynthetic-test-only',
    '研究 /etc/hosts 与 token%25253Dsynthetic-test-only']) denied(officialTitle(title));
  for (const title of ['研究 /etc/hosts 与收益 100%', '研究 %2Fetc%2Fhosts 与公开文本']) {
    const fused = fuse(officialTitle(title));
    assert.equal(fused.candidates[0].facts.title, title);
    assert.equal(assertArtifactSafe(fused).ok, true);
  }
});

test('supported relative configuration paths retain the same private identity', () => {
  const root = path.join(path.parse(process.cwd()).root, 'synthetic-private-title-context');
  for (const name of ['ZAG_CONFIG_DIR', 'ZHIHU_CLI_CONFIG', 'ZHIHU_CREATOR_CONFIG', 'P1_T10_ONNX_MODEL_DIR']) {
    const previous = process.env[name]; // Path configuration only; no credential values.
    try {
      for (const configured of [root, path.relative(process.cwd(), root)]) {
        assert.equal(path.resolve(configured), root);
        process.env[name] = configured;
        denied(officialTitle(`研究 ${path.join(root, 'private-state.json')}`));
      }
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});

test('URL fragments in inert prose keep URL credential guards across decoded layers', () => {
  for (const url of ['https://synthetic-user:synthetic-test-only@example.com/guide',
    'https://synthetic-user%3Asynthetic-test-only%40example.com/guide',
    'https%3A%2F%2Fsynthetic-user%3Asynthetic-test-only%40example.com/guide',
    'https:\\\\synthetic-user:synthetic-test-only@example.com/guide',
    'https:/synthetic-user:synthetic-test-only@example.com/guide',
    'https:synthetic-user:synthetic-test-only@example.com/guide']) {
    denied(officialTitle(`研究 /etc/hosts 与 ${url}`));
  }
  const title = '研究 /etc/hosts、https://example.com/guide 与公开文本';
  const fused = fuse(officialTitle(title));
  assert.equal(fused.candidates[0].facts.title, title);
  assert.equal(assertArtifactSafe(fused).ok, true);
});

test('URL userinfo cannot hide behind parser whitespace or punctuation in inert prose', () => {
  for (const separator of ['\t', '\n', '\r', ' ', '"', '<', '`', '%09', '%0A', '%0D']) {
    denied(officialTitle(`研究 /etc/hosts 与 https://synthetic-user:123${separator}@example.com/guide`));
  }
  denied(officialTitle('研究 /etc/hosts 与 ht\ntps://synthetic-user:123@example.com/guide'));
  const title = '研究 /etc/hosts 与 https://example.com/guide\n公开研究文本';
  const fused = fuse(officialTitle(title));
  assert.equal(fused.candidates[0].facts.title, title);
  assert.equal(assertArtifactSafe(fused).ok, true);
});

test('actual private home URL aliases retain privacy guards after parser whitespace removal', () => {
  const home = os.homedir().replaceAll('\\', '/');
  const at = Math.floor(home.length / 2);
  const urlPath = text => text.startsWith('/') ? text : '/' + text;
  for (const separator of ['\t', '\n', '\r', '%09', '%0A', '%0D']) {
    const alias = home.slice(0, at) + separator + home.slice(at);
    denied(officialTitle(`研究 /etc/hosts 与 https://example.com${urlPath(alias)}/.ssh/id_ed25519`));
  }
});

test('existing checkpoint hash binds the exact restored bytes; ordinary roundtrip grants nothing', () => {
  const fused = fuse(officialTitle(EXTERNAL_TITLE));
  const pool = { candidates: fused.candidates, channels: [], planHash: 'a'.repeat(64) };
  const bytes = Buffer.from(JSON.stringify(pool));
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(assertArtifactSafe(JSON.parse(bytes)).ok, false);
  const restored = parseBoundProviderPool(bytes, expected);
  assert.equal(assertArtifactSafe(restored).ok, true);
  assert.equal(restored.candidates[0].facts.title, EXTERNAL_TITLE);
  assert.equal(parseBoundProviderPool(Buffer.concat([bytes, Buffer.from(' ')]), expected), null);
  assert.equal(parseBoundProviderPool(bytes, null), null);
  restored.candidates[0].facts.title = '/etc/hosts changed';
  assert.equal(assertArtifactSafe(restored).ok, false);
});

test('injected global transport has no source qualification, even with a valid public source URL', () => {
  const result = createGlobalSearchAdapter({ transport: () => ({ status: 200, body: JSON.stringify({
    Code: 0, Data: { HasMore: false, Items: [{ Url: 'https://www.zhihu.com/question/123',
      Title: EXTERNAL_TITLE, ContentType: 'question', ContentID: '123', AuthorityLevel: 'public' }] },
  }) }) }).retrieve({ query: '合成研究' });
  denied(result);
});

test('title does not become a sensitive sink, trusted plan string, or arbitrary artifact string', () => {
  const candidate = fuse(officialTitle(EXTERNAL_TITLE)).candidates[0];
  assert.equal(isBoundarySafeString(candidate.facts.title), false);
  assert.equal(projectSafeJson({ path: candidate.facts.title }).ok, false);
  assert.equal(assertArtifactSafe({ candidates: [candidate], toolArgument: candidate.facts.title }).ok, false);
  assert.equal(assertArtifactSafe({ candidates: [candidate], query: candidate.facts.title }, {
    trustedPlanStrings: new Set([candidate.facts.title]),
  }).ok, false); // plan lens rejects Windows profile path, independently
});

test('a title-derived capture/tool argument is refused before IO, while a valid ID reaches the same sink', () => {
  let calls = 0;
  const capture = createSessionCaptureAdapter({ runner: () => {
    calls++; return { status: 1, stdout: '', stderr: '' };
  } });
  const title = fuse(officialTitle(EXTERNAL_TITLE)).candidates[0].facts.title;
  assert.equal(capture.retrieve({ questionId: title, outDir: 'out' }).failure.code, 'CAPTURE_INPUT_INVALID');
  assert.equal(calls, 0);
  capture.retrieve({ questionId: '123', outDir: 'out' });
  assert.equal(calls, 1);
  assert.equal(admitTargetedQueryString('/etc/hosts 研究', ['/etc/hosts 研究']).admitted, false);
  assert.equal(admitTargetedQueryString('合成研究', ['合成研究']).admitted, true);
});

test('fixed canonical global child qualifies external Title; custom child override cannot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-global-'));
  try {
    const preload = path.join(dir, 'network.mjs');
    fs.writeFileSync(preload, `globalThis.fetch = async (url) => {
      if (new URL(url).pathname !== '/api/v1/content/global_search') throw new Error('offline IO refused');
      return new Response(${JSON.stringify(JSON.stringify({ Code: 0, Data: { HasMore: false, Items: [{
        Url: 'https://www.zhihu.com/question/123', Title: EXTERNAL_TITLE,
        ContentType: 'question', ContentID: '123', AuthorityLevel: 'public',
      }] } }))}, { status: 200 });
    };`);
    const modules = name => pathToFileURL(path.resolve('research-orchestration/lib', name)).href;
    const code = `import {createSyncGlobalSearchTransport} from ${JSON.stringify(modules('p1-runtime-composer.mjs'))};
      import {createGlobalSearchAdapter} from ${JSON.stringify(modules('global-search-provider.mjs'))};
      import {rrfFusion,assertArtifactSafe} from ${JSON.stringify(modules('rrf.mjs'))};
      const r=createGlobalSearchAdapter({transport:createSyncGlobalSearchTransport()}).retrieve({query:'合成研究'});
      try {
        const f=rrfFusion([{channel:{query:'合成研究',providerId:r.provider_id,capability:'search'},items:r.items}]);
        console.log(JSON.stringify({ok:assertArtifactSafe(f).ok,preserved:f.candidates[0].facts.title===${JSON.stringify(EXTERNAL_TITLE)}}));
      } catch(e) {console.log(JSON.stringify({ok:false,code:e.code}));}`;
    const env = { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      ZHIHU_SECRET: 'synthetic-test-only', ZAG_CONFIG_DIR: dir };
    for (const override of [null, modules('global-search-bridge-child.mjs')]) {
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: dir, encoding: 'utf8', env: { ...env, ...(override ? { ZHIHU_GLOBAL_SEARCH_BRIDGE_CHILD_URL: override } : {}) },
      });
      assert.equal(res.status, 0);
      assert.deepEqual(JSON.parse(res.stdout), override
        ? { ok: false, code: 'FUSION_UNSAFE_PROVIDER_DATA' } : { ok: true, preserved: true });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
