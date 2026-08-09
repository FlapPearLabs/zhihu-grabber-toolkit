// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V2 Phase 1 — markdown-security 纯函数测试（全部 deterministic / offline）。
 *
 * 覆盖：escapeUntrustedMarkdownText、bare URL tokenizer、
 * URL sanitizer/classifier、link.zhihu redirect、safeMarkdownDestination。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeUntrustedMarkdownText,
  tokenizeBareUrls,
  classifyUrl,
  extractZhihuRedirectTarget,
  safeMarkdownDestination,
  classifyImageUrl,
} from '../src/markdown-security.js';

// ===== A. 普通 Markdown injection（§8.0 BLOCKER-1） =====

test('escape: 常见 Markdown injection 全部变为惰性文本', () => {
  const cases = [
    '[click](https://evil.example)',
    '![img](https://evil.example/x.png)',
    '<https://evil.example>',
    '# heading',
    '> quote',
    '- fake list',
    '1. fake list',
    '**bold injection**',
    '<div>html</div>',
  ];
  for (const input of cases) {
    const out = escapeUntrustedMarkdownText(input);
    // 惰性文本不含未转义的 [ ] ( ) # > - * < 等结构性字符
    assert.ok(!/\[[^\]\\]/.test(out) || !out.includes(']('), `[x](y) 不得残存: ${input}`);
    assert.ok(!out.match(/^#\s/m), `不得以 # 开头形成 heading: ${input}`);
    assert.ok(!out.match(/^>\s?/m), `不得形成 blockquote: ${input}`);
    assert.ok(!out.match(/^[-*+]\s/m), `不得形成列表: ${input}`);
    assert.ok(!out.match(/^\d+\.\s/m), `不得形成有序列表: ${input}`);
    // raw HTML：`<` 前不得是未转义状态（反斜杠前缀即被中和）
    assert.ok(!/(?<!\\)<[a-z][^>]*>/i.test(out), `不得透传 raw HTML: ${input}`);
    assert.ok(!/\*\*[^*]+\*\*/.test(out), `不得形成 bold: ${input}`);
  }
});

test('escape: 渲染后反斜杠不可见（阅读性不被破坏）', () => {
  // \# 在 Markdown 渲染时显示为 #，不产生 heading
  const out = escapeUntrustedMarkdownText('# heading');
  assert.equal(out, '\\# heading');
});

test('escape: 反斜杠本身被转义（不能中和后续转义）', () => {
  const out = escapeUntrustedMarkdownText('\\[click](https://evil.example)');
  assert.ok(out.includes('\\\\['), '反斜杠必须被转义');
  assert.ok(!out.includes('](https://'), '不得形成链接结构');
});

test('escape: 控制字符被替换为 U+FFFD', () => {
  const out = escapeUntrustedMarkdownText('a\u0000b\u001Fc\u007Fd');
  assert.ok(!/[\u0000-\u001F\u007F]/.test(out));
  assert.ok(out.includes('\uFFFD'));
  // 换行保留
  assert.equal(escapeUntrustedMarkdownText('a\nb'), 'a\nb');
});

test('escape: 空值/非字符串安全', () => {
  assert.equal(escapeUntrustedMarkdownText(null), '');
  assert.equal(escapeUntrustedMarkdownText(undefined), '');
  assert.equal(escapeUntrustedMarkdownText(123), '123');
});

test('escape: code fence 反引号被转义，不能产生 fenced block', () => {
  const out = escapeUntrustedMarkdownText('```bash\nrm -rf\n```');
  assert.ok(!out.includes('```'), '三重反引号不得原样残存');
  assert.ok(out.includes('\\`\\`\\`'));
});

// ===== P1-1: 行级结构中和（Setext heading / indented code block） =====

test('escape-P1-1: Setext H1（= 行）不能由不可信文本产生', () => {
  const out = escapeUntrustedMarkdownText('foo\n===');
  assert.ok(out.includes('\\==='), '等号行首必须被转义');
  assert.ok(!out.includes('\n==='), '不得残留未转义 Setext underline');
});

test('escape-P1-1: 缩进 Setext（0-3 空格 + = 行）被中和', () => {
  const out = escapeUntrustedMarkdownText('foo\n   ===');
  assert.ok(!out.includes('\n   ==='), '带缩进的 Setext underline 必须被中和');
  assert.ok(out.includes('\\==='), '等号首字符必须被转义');
});

test('escape-P1-1: 4 空格 indented code 行被中和', () => {
  const out = escapeUntrustedMarkdownText('foo\n\n    indented');
  assert.ok(!out.includes('\n    indented'), '4 空格缩进行不得原样保留');
  assert.ok(out.includes('\u00A0   indented'), '首个前导空格替换为 NBSP，行首不再是指标空格');
});

test('escape-P1-1: Tab indented code 行被中和', () => {
  const out = escapeUntrustedMarkdownText('foo\n\tindented');
  assert.ok(!out.includes('\n\tindented'), 'Tab 缩进行不得原样保留');
  assert.ok(out.includes('\u00A0indented'), 'Tab 替换为 NBSP');
});

test('escape-P1-1: 普通 `a = b` 保持可读（不全局转义 =）', () => {
  assert.equal(escapeUntrustedMarkdownText('a = b'), 'a = b');
  assert.equal(escapeUntrustedMarkdownText('x = y = z'), 'x = y = z');
});

test('escape-P1-1: Setext H2（--- 行）经字符级转义已被中和', () => {
  const out = escapeUntrustedMarkdownText('foo\n---');
  assert.ok(!out.includes('\n---'), '--- 行必须被转义（Setext H2 / thematic break）');
  assert.ok(out.includes('\\-\\-\\-'));
});

test('escape-P1-1: 单行纯等号也要中和（独立 text node 可能被拼接到行首）', () => {
  // cross-node 场景：<p>foo<br>===</p> 中 "===" 是独立 text node，只有一行；
  // 中和必须对每一行（含第一行）生效
  assert.equal(escapeUntrustedMarkdownText('==='), '\\===');
  assert.equal(escapeUntrustedMarkdownText('    indented'), '\u00A0   indented');
  assert.equal(escapeUntrustedMarkdownText('\tindented'), '\u00A0indented');
});

test('escape-P1-1-split: 任意 leading 空白的首字符必变 NBSP（防跨节点累计）', () => {
  // 每个 fragment 自己不足 4 空格，拼接后也不能累计出 4 个 ASCII 空格行首
  assert.equal(escapeUntrustedMarkdownText('  hello'), '\u00A0 hello');
  assert.equal(escapeUntrustedMarkdownText('   '), '\u00A0  ');
  assert.equal(escapeUntrustedMarkdownText(' '), '\u00A0');
  // 拼接模拟：NBSP 断点使 ASCII 空格无法连续累计
  const joined = escapeUntrustedMarkdownText('  ') + escapeUntrustedMarkdownText('  injected');
  assert.equal(joined, '\u00A0 \u00A0 injected');
  assert.ok(!/^ {4}\S/.test(joined), '拼接后不得形成 4 空格缩进行首');
});

test('escape-P1-1-split: 行中/非行首空白不受影响（普通 spacing 可读）', () => {
  assert.equal(escapeUntrustedMarkdownText('Hello world'), 'Hello world');
  assert.equal(escapeUntrustedMarkdownText('a  b'), 'a  b');
  assert.equal(escapeUntrustedMarkdownText('x === y'), 'x === y');
});

test('escape-P1-1: 多行组合 payload 全部惰性化', () => {
  const payload = 'foo\n===\n\nfoo\n\n    indented-code\n\nfoo\n\tindented-code';
  const out = escapeUntrustedMarkdownText(payload);
  assert.ok(!out.includes('\n==='), 'Setext H1 不得出现');
  assert.ok(!out.includes('\n    indented'), '4 空格缩进不得出现');
  assert.ok(!out.includes('\n\tindented'), 'Tab 缩进不得出现');
});

// ===== bare URL tokenizer（§8.0.1 / §8.0.2） =====

test('tokenize: 识别裸 https/http URL span', () => {
  const spans = tokenizeBareUrls('看这里 https://example.com/a 和 http://x.io 结束');
  const urls = spans.filter((s) => s.type === 'url').map((s) => s.url);
  assert.deepEqual(urls, ['https://example.com/a', 'http://x.io']);
});

test('tokenize: 无 URL → 单一 text span', () => {
  const spans = tokenizeBareUrls('纯文本，没有链接');
  assert.deepEqual(spans, [{ type: 'text', text: '纯文本，没有链接' }]);
});

test('tokenize: URL 尾部标点被修剪（不影响 URL 本体）', () => {
  const spans = tokenizeBareUrls('去 https://example.com。');
  const urls = spans.filter((s) => s.type === 'url').map((s) => s.url);
  assert.deepEqual(urls, ['https://example.com']);
});

test('tokenize: 成对括号保留在 URL 内', () => {
  const spans = tokenizeBareUrls('见 https://example.com/a_(b) 后面');
  const urls = spans.filter((s) => s.type === 'url').map((s) => s.url);
  assert.deepEqual(urls, ['https://example.com/a_(b)']);
});

test('tokenize: 不成对右括号被修剪', () => {
  const spans = tokenizeBareUrls('见 https://example.com/a) 后面');
  const urls = spans.filter((s) => s.type === 'url').map((s) => s.url);
  assert.deepEqual(urls, ['https://example.com/a']);
});

// ===== B. URL sanitizer / classifier（§11） =====

test('url: 公网 https → clickable external_unverified', () => {
  const r = classifyUrl('https://example.com/path?q=1');
  assert.equal(r.clickable, true);
  assert.equal(r.securityClass, 'external_unverified');
  assert.equal(r.displayHost, 'example.com');
  assert.ok(r.canonicalUrl.startsWith('https://example.com/'));
});

test('url: 不输出 safe/trusted/verified 字段', () => {
  const r = classifyUrl('https://example.com');
  assert.ok(!('safe' in r), '不得有 safe 字段');
  assert.ok(!('trusted' in r), '不得有 trusted 字段');
  assert.ok(!('verified' in r), '不得有 verified 字段');
});

test('url: 危险 scheme 全部拒绝', () => {
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'blob:https://example.com/abc',
    'ftp://example.com/file',
    'http://example.com', // 第一版 clickable 只允许 https:
  ]) {
    assert.equal(classifyUrl(bad), null, `${bad} 必须被拒绝`);
  }
});

test('url: 无法解析/非法 URL 拒绝', () => {
  assert.equal(classifyUrl('not a url'), null);
  assert.equal(classifyUrl(''), null);
  assert.equal(classifyUrl(null), null);
  assert.equal(classifyUrl(undefined), null);
});

test('url: 控制字符 URL 拒绝', () => {
  assert.equal(classifyUrl('https://example.com/\u0000x'), null);
  assert.equal(classifyUrl('https://example.com/a\nb'), null);
});

// ===== C. SSRF / local（§11.3） =====

test('url: localhost 拒绝', () => {
  assert.equal(classifyUrl('https://localhost/'), null);
  assert.equal(classifyUrl('https://localhost:8080/'), null);
  assert.equal(classifyUrl('https://LOCALHOST/'), null);
});

test('url-P2: localhost namespace（*.localhost）拒绝', () => {
  assert.equal(classifyUrl('https://foo.localhost/'), null);
  assert.equal(classifyUrl('https://a.b.localhost/'), null);
  assert.equal(classifyUrl('https://foo.localhost./'), null); // 尾点规范化
  assert.equal(classifyUrl('https://api.localhost:8080/'), null);
  // 公网域名不受影响（.localhost 结尾才是本机解析域）
  assert.notEqual(classifyUrl('https://localhost.com/'), null);
  assert.notEqual(classifyUrl('https://evil.localhost.com/'), null);
});

test('url: 回环 IP 拒绝（IPv4 + IPv6）', () => {
  assert.equal(classifyUrl('https://127.0.0.1/'), null);
  assert.equal(classifyUrl('https://127.1.2.3/'), null);
  assert.equal(classifyUrl('https://[::1]/'), null);
  assert.equal(classifyUrl('https://[0:0:0:0:0:0:0:1]/'), null);
});

test('url: 私有 IPv4 拒绝', () => {
  assert.equal(classifyUrl('https://10.0.0.1/'), null);
  assert.equal(classifyUrl('https://172.16.0.1/'), null);
  assert.equal(classifyUrl('https://172.31.255.255/'), null);
  assert.equal(classifyUrl('https://192.168.1.1/'), null);
  // 边界：172.15/172.32 不是私有
  assert.notEqual(classifyUrl('https://172.15.0.1/'), null);
  assert.notEqual(classifyUrl('https://172.32.0.1/'), null);
});

test('url: link-local IPv4 拒绝', () => {
  assert.equal(classifyUrl('https://169.254.0.1/'), null);
  assert.equal(classifyUrl('https://169.254.169.254/'), null); // metadata
});

test('url: 私有/link-local IPv6 拒绝', () => {
  assert.equal(classifyUrl('https://[fc00::1]/'), null);
  assert.equal(classifyUrl('https://[fd00::1]/'), null);
  assert.equal(classifyUrl('https://[fe80::1]/'), null);
  assert.equal(classifyUrl('https://[::]/'), null);
});

test('url: IPv4-mapped IPv6 回环/私有拒绝', () => {
  assert.equal(classifyUrl('https://[::ffff:127.0.0.1]/'), null);
  assert.equal(classifyUrl('https://[::ffff:192.168.0.1]/'), null);
});

test('url: 公网 IP 允许', () => {
  assert.notEqual(classifyUrl('https://8.8.8.8/'), null);
  assert.notEqual(classifyUrl('https://[2606:4700:4700::1111]/'), null);
});

// ===== D. userinfo（§11.3） =====

test('url: userinfo 拒绝', () => {
  assert.equal(classifyUrl('https://user:pass@example.com/'), null);
  assert.equal(classifyUrl('https://user@example.com/'), null);
});

// ===== E. Zhihu redirect（§11.1） =====

test('redirect: 提取 target 参数', () => {
  const target = extractZhihuRedirectTarget('https://link.zhihu.com/?target=https%3A%2F%2Fgithub.com%2Ffoo%2Fbar');
  assert.equal(target, 'https://github.com/foo/bar');
});

test('redirect: 非 link.zhihu.com → null', () => {
  assert.equal(extractZhihuRedirectTarget('https://www.zhihu.com/question/123'), null);
  assert.equal(extractZhihuRedirectTarget('https://evil.com/?target=x'), null);
});

test('redirect: link.zhihu.com → 合法 https 公网 target → 可点击 target', () => {
  const r = classifyUrl('https://link.zhihu.com/?target=https%3A%2F%2Fgithub.com%2Ffoo');
  assert.notEqual(r, null);
  assert.equal(r.clickable, true);
  assert.equal(r.displayHost, 'github.com');
  assert.equal(r.zhihuRedirect.targetUrl, 'https://github.com/foo');
  assert.equal(r.zhihuRedirect.clickable, true);
});

test('redirect: link.zhihu.com → javascript: → 拒绝', () => {
  assert.equal(classifyUrl('https://link.zhihu.com/?target=javascript%3Aalert(1)'), null);
});

test('redirect: link.zhihu.com → localhost → 拒绝', () => {
  assert.equal(classifyUrl('https://link.zhihu.com/?target=https%3A%2F%2Flocalhost%2F'), null);
});

test('redirect: link.zhihu.com → 私有 IP → 拒绝', () => {
  assert.equal(classifyUrl('https://link.zhihu.com/?target=http%3A%2F%2F127.0.0.1%2F'), null);
  assert.equal(classifyUrl('https://link.zhihu.com/?target=https%3A%2F%2F10.0.0.1%2F'), null);
});

test('redirect: malformed target → 拒绝', () => {
  assert.equal(classifyUrl('https://link.zhihu.com/?target=not-a-url'), null);
  assert.equal(classifyUrl('https://link.zhihu.com/'), null); // 无 target 参数
  assert.equal(classifyUrl('https://link.zhihu.com/?target='), null);
});

test('redirect: 不能因来源是 link.zhihu.com 就自动放行', () => {
  // link.zhihu.com 自身作为最终目标不允许
  assert.equal(classifyUrl('https://link.zhihu.com/'), null);
});

// ===== F. Markdown destination（§11.5.1 BLOCKER-9） =====

test('destination: 不破坏 Markdown 链接语法', () => {
  const cases = [
    'https://example.com/a_(b)',
    'https://example.com/a<b>c',
    'https://example.com/a\\b',
    'https://example.com/a b',
    'https://example.com/a\nb',
    'https://example.com/a\u0000b',
  ];
  for (const url of cases) {
    const dest = safeMarkdownDestination(url);
    const md = `[label](${dest})`;
    // 不得残留未编码的破坏性字符（%xx 已是安全编码）
    assert.ok(!/[()<>\s]/.test(dest), `残留破坏字符: ${url}`);
    assert.ok(!/[\u0000-\u001F\u007F]/.test(dest), `残留控制字符: ${url}`);
    // 编码后仍可被 URL parser 接受（往返无结构破坏）
    assert.ok(md.length > 0);
  }
});

test('destination: 括号/尖括号/反斜杠被 percent-encode', () => {
  assert.equal(safeMarkdownDestination('https://example.com/a_(b)'), 'https://example.com/a_%28b%29');
  assert.equal(safeMarkdownDestination('https://example.com/a<b>'), 'https://example.com/a%3Cb%3E');
  assert.equal(safeMarkdownDestination('https://example.com/a\\b'), 'https://example.com/a%5Cb');
  assert.equal(safeMarkdownDestination('https://example.com/a b'), 'https://example.com/a%20b');
});

test('destination: 空输入安全', () => {
  assert.equal(safeMarkdownDestination(''), '');
  assert.equal(safeMarkdownDestination(null), '');
});

test('destination: 与 sanitizer 是两个独立边界（分别测试）', () => {
  // 合法 URL 经 destination 后仍合法
  const cls = classifyUrl('https://example.com/a_(b)?x=1');
  const dest = safeMarkdownDestination(cls.canonicalUrl);
  assert.ok(!dest.includes('(') && !dest.includes(')'));
});

// ===== K. §10.2 classifyImageUrl（图片 URL 分类：detected 与 clickable 分离） =====

test('image: zhimg.com 主域 https → clickable zhimg_cdn', () => {
  const r = classifyImageUrl('https://zhimg.com/foo.png');
  assert.equal(r.detected, true);
  assert.equal(r.clickable, true);
  assert.equal(r.securityClass, 'zhimg_cdn');
  assert.equal(r.host, 'zhimg.com');
});

test('image: zhimg 子域（picx/pica）→ clickable zhimg_cdn', () => {
  for (const host of ['picx.zhimg.com', 'pica.zhimg.com', 'pic1.zhimg.com']) {
    const r = classifyImageUrl(`https://${host}/x.png`);
    assert.equal(r.clickable, true, `${host} 应可点击`);
    assert.equal(r.securityClass, 'zhimg_cdn');
  }
});

test('image: evilzhimg.com / zhimg.com.evil.com 拒绝（eTLD+1 标签级校验）', () => {
  const evil = ['https://evilzhimg.com/x.png', 'https://zhimg.com.evil.com/x.png', 'https://notzhimg.com/x.png', 'https://zhimg.com.cn/x.png'];
  for (const url of evil) {
    const r = classifyImageUrl(url);
    assert.equal(r.detected, true, `${url} 应记录存在`);
    assert.equal(r.clickable, false, `${url} 不得可点击`);
    assert.equal(r.securityClass, 'external_image_untrusted');
  }
});

test('image: 非 https 协议（http）不可点击', () => {
  const r = classifyImageUrl('http://picx.zhimg.com/x.png');
  assert.equal(r.detected, true);
  assert.equal(r.clickable, false);
  assert.equal(r.securityClass, 'external_image_untrusted');
});

test('image: data:/blob: placeholder 返回 null（调用方完全忽略，不进 assets）', () => {
  assert.equal(classifyImageUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(classifyImageUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), null);
  assert.equal(classifyImageUrl('blob:https://example.com/uuid'), null);
});

test('image: 空/null/控制字符 → null', () => {
  assert.equal(classifyImageUrl(''), null);
  assert.equal(classifyImageUrl(null), null);
  assert.equal(classifyImageUrl('https://picx.zhimg.com/\u0000x.png'), null);
});

test('image: 无法解析的 https 形态 → detected 但不可点击', () => {
  // 无法被 WHATWG parser 解析的异常 URL：保守记录存在、不生成 href
  const r = classifyImageUrl('https://');
  assert.equal(r.detected, true);
  assert.equal(r.clickable, false);
  assert.equal(r.securityClass, 'external_image_untrusted');
});

test('image: 无效 percent-encoding 由 WHATWG 宽容保留（host 仍 zhimg → 可点击，不视为 unparsable）', () => {
  const r = classifyImageUrl('https://picx.zhimg.com/%zz');
  assert.equal(r.detected, true);
  assert.equal(r.clickable, true);
  assert.equal(r.securityClass, 'zhimg_cdn');
});

test('image: 非图片主机真实 URL → detected + clickable=false（§10.1 记录存在）', () => {
  const r = classifyImageUrl('https://example.com/x.png');
  assert.equal(r.detected, true);
  assert.equal(r.clickable, false);
  assert.equal(r.securityClass, 'external_image_untrusted');
  assert.equal(r.host, 'example.com');
});

test('image: zhimg URL 规范化后 displayUrl 为 canonical href', () => {
  const r = classifyImageUrl('https://picx.zhimg.com/x.png');
  assert.equal(r.clickable, true);
  assert.equal(r.displayUrl, 'https://picx.zhimg.com/x.png');
});
