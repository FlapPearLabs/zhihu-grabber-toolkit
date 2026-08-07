import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RENDER = fileURLToPath(new URL('../scripts/render-final.mjs', import.meta.url));

function runRender(finalObj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhihu-render-'));
  const finalFile = path.join(dir, 'final.json');
  const outFile = path.join(dir, 'digest.md');
  fs.writeFileSync(finalFile, JSON.stringify(finalObj, null, 2));
  const r = spawnSync(process.execPath, [RENDER, '--final', finalFile, '--out', outFile], { encoding: 'utf8' });
  const md = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  return { status: r.status, md, stderr: r.stderr };
}

const VALID_CLAIM = { text: '正常观点', evidenceSourceIds: ['question-123-answer-1'], confidence: 'high' };

test('render-final: <script> 不得以 raw HTML 出现（P1-3 Case A）', () => {
  const { status, md } = runRender({ schemaVersion: 1, mode: 'digest', claims: [{ ...VALID_CLAIM, text: '<script>alert(1)</script>' }] });
  assert.equal(status, 0);
  assert.ok(!md.includes('<script>'), '输出不得包含 raw <script> 标签');
  assert.ok(md.includes('&lt;script&gt;'), '应转义为实体');
});

test('render-final: <img onerror> 不得以 raw HTML 标签形式存在（P1-3 Case B）', () => {
  const { status, md } = runRender({ schemaVersion: 1, mode: 'digest', claims: [{ ...VALID_CLAIM, text: '<img src=x onerror=alert(1)>' }] });
  assert.equal(status, 0);
  assert.ok(!/<img[^>]*onerror/i.test(md), '输出不得包含 raw <img ... onerror> 标签');
  assert.ok(md.includes('&lt;img'), 'img 标签应被转义');
});

test('render-final: 双转义实体不得恢复成 raw <script>（P1-3 Case C）', () => {
  const { status, md } = runRender({ schemaVersion: 1, mode: 'digest', claims: [{ ...VALID_CLAIM, text: '&lt;script&gt;alert(1)&lt;/script&gt;' }] });
  assert.equal(status, 0);
  assert.ok(!md.includes('<script>'), '输出不得恢复成 raw <script>');
});

test('render-final: 换行注入的 Markdown H1 不得产生新结构（P1-3 Case D）', () => {
  const { status, md } = runRender({ schemaVersion: 1, mode: 'digest', claims: [{ ...VALID_CLAIM, text: 'hello\n# injected heading' }] });
  assert.equal(status, 0);
  // 换行被折叠为空格，且 # 被转义 → 不产生新的行首 # 结构
  assert.ok(!/^# injected heading/m.test(md), '不得产生新的 Markdown H1');
  assert.ok(md.includes('# injected heading'), '内容本身保留（作为行内文本）');
});

test('render-final: minorityViews / uncertainties 中的 HTML 同样安全（P1-3 Case E）', () => {
  const { status, md } = runRender({
    schemaVersion: 1,
    mode: 'digest',
    claims: [VALID_CLAIM],
    minorityViews: ['<b>少数派</b>'],
    uncertainties: ['<script>alert(2)</script>'],
  });
  assert.equal(status, 0);
  assert.ok(!md.includes('<b>'), 'minorityViews 不得含 raw <b>');
  assert.ok(!md.includes('<script>'), 'uncertainties 不得含 raw <script>');
  assert.ok(md.includes('&lt;b&gt;') && md.includes('&lt;script&gt;'), '应转义为实体');
});

test('render-final: sourceId 保持原样（受控格式不受转义影响）', () => {
  const { status, md } = runRender({ schemaVersion: 1, mode: 'digest', claims: [VALID_CLAIM] });
  assert.equal(status, 0);
  assert.ok(md.includes('[question-123-answer-1]'), '系统生成的 sourceId 直接渲染');
});
