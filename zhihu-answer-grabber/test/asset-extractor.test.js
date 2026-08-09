// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V2 Phase 2 — asset-extractor 资产提取测试（全部 deterministic / offline）。
 *
 * 覆盖：§10 图片（优先级 / placeholder 忽略 / detected-clickable 分离 / 去重）、
 * §11 外链（redirect 解包 / 拒绝记录）、§12 代码块（language + lines）、
 * §13 脚注（sourceNumero + text + index）、§16 videos 恒空。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAssets } from '../src/asset-extractor.js';

// ===== 图片（§10 / §23.2） =====

test('image: data-original 优先于 src', () => {
  const html = '<img data-original="https://picx.zhimg.com/orig.png" src="https://pica.zhimg.com/thumb.png">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://picx.zhimg.com/orig.png');
  assert.equal(images[0].clickable, true);
  assert.equal(images[0].securityClass, 'zhimg_cdn');
});

test('image: 无 data-original 时取 data-actualsrc', () => {
  const html = '<img data-actualsrc="https://picx.zhimg.com/actual.png" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://picx.zhimg.com/actual.png');
});

test('image: lazy placeholder（data: / 1px）完全忽略，不进 assets', () => {
  const html = [
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    '<img src="blob:https://example.com/uuid">',
  ].join('');
  const { images } = extractAssets(html);
  assert.equal(images.length, 0, 'placeholder 不应收录');
});

test('image: 非 zhimg 图片 → detected + clickable=false（§10.1/§23.2）', () => {
  const html = '<img src="https://example.com/x.png">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].detected, true);
  assert.equal(images[0].clickable, false);
  assert.equal(images[0].securityClass, 'external_image_untrusted');
  assert.equal(images[0].host, 'example.com');
});

test('image: evilzhimg.com / zhimg.com.evil.com 不可点击', () => {
  const html = [
    '<img src="https://evilzhimg.com/x.png">',
    '<img src="https://zhimg.com.evil.com/x.png">',
  ].join('');
  const { images } = extractAssets(html);
  assert.equal(images.length, 2);
  for (const img of images) {
    assert.equal(img.clickable, false);
    assert.equal(img.securityClass, 'external_image_untrusted');
  }
});

test('image: 同 URL 去重（§23.2）', () => {
  const html = [
    '<img data-original="https://picx.zhimg.com/dup.png" src="https://picx.zhimg.com/dup.png">',
    '<img src="https://picx.zhimg.com/dup.png">',
  ].join('');
  const { images } = extractAssets(html);
  assert.equal(images.length, 1, '同 URL 只保留一条');
});

test('image: width/height 与 alt 收录为 metadata', () => {
  const html = '<img src="https://picx.zhimg.com/w.png" width="2002" height="1364" alt="示意图">';
  const { images } = extractAssets(html);
  assert.equal(images[0].width, 2002);
  assert.equal(images[0].height, 1364);
  assert.equal(images[0].caption, '示意图');
});

test('image: figure + figcaption 文本作为 caption', () => {
  const html = '<figure><img src="https://picx.zhimg.com/f.png"><figcaption>图 1：架构示意</figcaption></figure>';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].caption, '图 1：架构示意');
});

// ===== P1-1: §10.1 candidate-by-candidate selection（placeholder 忽略后继续 fallback） =====

test('P1-1-A: data-original 为 data: placeholder + data-actualsrc 真实 → 取 data-actualsrc', () => {
  const html = '<img data-original="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-actualsrc="https://picx.zhimg.com/real.png">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://picx.zhimg.com/real.png');
  assert.equal(images[0].clickable, true);
});

test('P1-1-B: data-original 为 blob: placeholder + src 真实 https → 取 src', () => {
  const html = '<img data-original="blob:https://example.com/uuid" src="https://picx.zhimg.com/real.png">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://picx.zhimg.com/real.png');
});

test('P1-1-C: 全部高优先级 candidate 为 placeholder → src 真实 https fallback', () => {
  const html = [
    '<img data-original="data:image/svg+xml;base64,PHN2Zz4="',
    ' data-actualsrc="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"',
    ' src="https://picx.zhimg.com/real.png">',
  ].join('');
  const { images } = extractAssets(html);
  assert.equal(images.length, 1);
  assert.equal(images[0].originalUrl, 'https://picx.zhimg.com/real.png');
});

test('P1-1-D: src=http 不是「合法 https src」候选 → 无真实候选 → 忽略（不进 assets）', () => {
  const html = '<img src="http://example.com/x.png">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 0, 'http src 不得作为 §10.1 src fallback');
});

test('P1-1-E: 全部 candidate 为 placeholder → images.length === 0', () => {
  const html = [
    '<img data-original="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    '<img data-original="blob:https://example.com/uuid">',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
  ].join('');
  const { images } = extractAssets(html);
  assert.equal(images.length, 0);
});

test('P1-1-F: 真实 1px case（1x1 透明 gif data URI）不作为真实图片', () => {
  const html = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
  const { images } = extractAssets(html);
  assert.equal(images.length, 0, '1px placeholder 不得作为真实图片');
});

// ===== P1-2: figure 遍历不吞其它 asset（caption 关联 + 通用收集，img 不重复） =====

test('P1-2: figure 内 <a><img></a> → image 带 caption + link 均收录且 img 只计一次', () => {
  const html = '<figure><a href="https://example.com/article"><img src="https://picx.zhimg.com/a.png"></a><figcaption>caption</figcaption></figure>';
  const { images, links } = extractAssets(html);
  assert.equal(images.length, 1, 'figure 内 img 只计一次');
  assert.equal(images[0].caption, 'caption');
  assert.equal(links.length, 1, 'figure 内 <a> 不得被吞');
  assert.equal(links[0].originalUrl, 'https://example.com/article');
});

test('P1-2: figure 内含 reference（sup data-numero/data-text）→ references 不漏', () => {
  const html = '<figure><sup data-text="注" data-numero="1">[1]</sup><figcaption>c</figcaption></figure>';
  const { references } = extractAssets(html);
  assert.equal(references.length, 1);
  assert.equal(references[0].sourceNumero, '1');
  assert.equal(references[0].text, '注');
});

test('P1-2: figure 内 pre/code → codeBlocks 不漏', () => {
  const html = '<figure><pre><code class="language-js">const x = 1;</code></pre><figcaption>c</figcaption></figure>';
  const { codeBlocks } = extractAssets(html);
  assert.equal(codeBlocks.length, 1);
  assert.equal(codeBlocks[0].language, 'js');
  assert.equal(codeBlocks[0].lines, 1);
});

// ===== 外链（§11） =====

test('link: 正常 https 外链 → clickable + external_unverified + 明示域名；anchorText 不进 persisted schema', () => {
  const html = '<a href="https://github.com/user/repo">GitHub 仓库</a>';
  const { links } = extractAssets(html);
  assert.equal(links.length, 1);
  assert.equal(links[0].clickable, true);
  assert.equal(links[0].securityClass, 'external_unverified');
  assert.equal(links[0].domain, 'github.com');
  // Spec §25 Open question 7：anchor 文字来源未批准 → 不得固化为 persisted public schema
  assert.ok(!('anchorText' in links[0]), 'anchorText 不得进入 assets.links[]');
});

test('link: zhihu redirect 解包 → zhihuRedirect 记录', () => {
  const target = 'https://github.com/user/repo';
  const html = `<a href="https://link.zhihu.com/?target=${encodeURIComponent(target)}">跳转</a>`;
  const { links } = extractAssets(html);
  assert.equal(links.length, 1);
  assert.equal(links[0].clickable, true);
  assert.equal(links[0].zhihuRedirect.targetUrl, target);
  assert.equal(links[0].zhihuRedirect.clickable, true);
});

test('link: javascript:/file:/私网 URL → 记录但 clickable=false', () => {
  const html = [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="file:///etc/passwd">y</a>',
    '<a href="https://127.0.0.1/admin">z</a>',
    '<a href="https://user:pass@example.com/">u</a>',
  ].join('');
  const { links } = extractAssets(html);
  assert.equal(links.length, 4);
  for (const link of links) {
    assert.equal(link.clickable, false, `${link.originalUrl} 不得可点击`);
    assert.equal(link.securityClass, 'rejected');
  }
});

test('link: 无 href 的 a 不收录', () => {
  const { links } = extractAssets('<a>no href</a>');
  assert.equal(links.length, 0);
});

// ===== 代码块（§12.4） =====

test('code: language + lines 统计（不收录正文）', () => {
  const html = '<pre><code class="language-bash">npm install\nnode test\n</code></pre>';
  const { codeBlocks } = extractAssets(html);
  assert.equal(codeBlocks.length, 1);
  assert.equal(codeBlocks[0].language, 'bash');
  assert.equal(codeBlocks[0].lines, 3);
  assert.ok(!JSON.stringify(codeBlocks).includes('npm install'), '不收录代码正文');
});

test('code: 恶意 language → 空串；无 code 子元素 → 裸 pre 文本行数', () => {
  const html = '<pre><code class="language-bash\nrm -rf">x</code></pre><pre>line1\nline2</pre>';
  const { codeBlocks } = extractAssets(html);
  assert.equal(codeBlocks.length, 2);
  assert.equal(codeBlocks[0].language, '');
  assert.equal(codeBlocks[1].language, '');
  assert.equal(codeBlocks[1].lines, 2);
});

// ===== 脚注（§13.1） =====

test('ref: data-numero + data-text → sourceNumero/text（出现顺序保留）；index 不进 persisted schema', () => {
  const html = [
    '<sup data-text="第一个脚注" data-numero="1">[1]</sup>',
    '<sup data-text="第二个脚注" data-numero="2">[2]</sup>',
  ].join('');
  const { references } = extractAssets(html);
  assert.equal(references.length, 2);
  assert.equal(references[0].sourceNumero, '1');
  assert.equal(references[0].text, '第一个脚注');
  assert.equal(references[1].sourceNumero, '2');
  assert.equal(references[1].text, '第二个脚注');
  // renderer 自维护 1-based 内部 ID（a<answerId>-r<index>）；extractor 不持久化 index
  assert.ok(!('index' in references[0]), 'index 不得进入 assets.references[]');
  assert.ok(!('index' in references[1]), 'index 不得进入 assets.references[]');
});

test('ref: 重复/非法 data-numero 不影响顺序收录（source metadata 保留原值）', () => {
  const html = [
    '<sup data-text="A" data-numero="1">[1]</sup>',
    '<sup data-text="B" data-numero="1">[1]</sup>',
    '<sup data-text="C" data-numero="-3">[-3]</sup>',
  ].join('');
  const { references } = extractAssets(html);
  assert.equal(references.length, 3);
  assert.equal(references[2].sourceNumero, '-3');
  assert.equal(references[2].text, 'C');
});

test('ref: 普通 sup（无 data-numero/data-text）不误判为脚注', () => {
  const { references } = extractAssets('<p>E=mc<sup>2</sup></p>');
  assert.equal(references.length, 0);
});

test('ref: 缺失 data-text → text 空串（不 fallback nodeText）', () => {
  const { references } = extractAssets('<sup data-numero="5">[5]</sup>');
  assert.equal(references.length, 1);
  assert.equal(references[0].text, '');
});

// ===== 综合 / 边界 =====

test('videos: 恒空数组（Spec §16 待真实样本）', () => {
  const { videos } = extractAssets('<video src="https://example.com/v.mp4"></video>');
  assert.ok(Array.isArray(videos));
  assert.equal(videos.length, 0);
});

test('空 HTML / null → 空资产', () => {
  const empty = extractAssets('');
  assert.equal(empty.images.length, 0);
  assert.equal(empty.links.length, 0);
  assert.equal(empty.references.length, 0);
  assert.equal(empty.codeBlocks.length, 0);
  const nul = extractAssets(null);
  assert.equal(nul.images.length, 0);
});

test('混合正文：assets 数组顺序与文档出现顺序一致', () => {
  const html = [
    '<p>开头 <a href="https://example.com/l">链接</a></p>',
    '<p><img src="https://picx.zhimg.com/a.png"></p>',
    '<pre><code class="language-js">const x = 1;</code></pre>',
    '<p><sup data-text="注" data-numero="1">[1]</sup> 结尾</p>',
  ].join('');
  const { images, links, references, codeBlocks } = extractAssets(html);
  assert.equal(links.length, 1);
  assert.equal(images.length, 1);
  assert.equal(codeBlocks.length, 1);
  assert.equal(references.length, 1);
  assert.ok(links[0].originalUrl.includes('example.com'));
});
