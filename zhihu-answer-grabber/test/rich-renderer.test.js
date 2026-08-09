// SPDX-License-Identifier: AGPL-3.0-only
/**
 * V2 Phase 1 — rich-renderer 白名单 HTML → Markdown 测试（全部 deterministic / offline）。
 *
 * 覆盖：§14 白名单元素、heading offset（§14.1.1）、inline/fenced code 安全（§12.3）、
 * 危险/未知 HTML（§14.3/§18）、图片/脚注 Phase 1 fallback（§19/§20）、
 * answer framing（§23.3 J）、不可信 metadata（§23.3.1）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { richHtmlToMarkdown, longestBacktickRun } from '../src/rich-renderer.js';
import { renderAnswers } from '../src/render.js';

// ===== 白名单纯排版结构（§14.1） =====

test('render: 段落', () => {
  assert.equal(richHtmlToMarkdown('<p>第一段</p><p>第二段</p>'), '第一段\n\n第二段');
});

test('render: br 换行', () => {
  assert.equal(richHtmlToMarkdown('<p>第一行<br/>第二行</p>'), '第一行\n第二行');
});

test('render: 实体解码（< 等结构字符经 escaping 后为字面显示）', () => {
  // &amp; → &（原样）；&lt; → <（转义为 \<，Markdown 渲染显示为 <）
  assert.equal(richHtmlToMarkdown('<p>a &amp; b &lt; c &#20013;</p>'), 'a & b \\< c 中');
});

test('render: 粗体/斜体', () => {
  assert.equal(richHtmlToMarkdown('<p><strong>粗</strong>和<em>斜</em></p>'), '**粗**和*斜*');
  assert.equal(richHtmlToMarkdown('<p><b>b</b><i>i</i></p>'), '**b***i*');
});

test('render: 无序列表', () => {
  const md = richHtmlToMarkdown('<ul><li>甲</li><li>乙</li></ul>');
  assert.equal(md, '- 甲\n- 乙');
});

test('render: 有序列表', () => {
  const md = richHtmlToMarkdown('<ol><li>一</li><li>二</li></ol>');
  assert.equal(md, '1. 一\n2. 二');
});

test('render: 嵌套列表保留层级', () => {
  const md = richHtmlToMarkdown('<ul><li>外层<ul><li>内层</li></ul></li></ul>');
  assert.ok(md.includes('- 外层'));
  assert.ok(md.includes('  - 内层'), `嵌套列表应缩进: ${md}`);
});

test('render: blockquote', () => {
  assert.equal(richHtmlToMarkdown('<blockquote>引用文字</blockquote>'), '> 引用文字');
});

test('render: 嵌套 blockquote', () => {
  const md = richHtmlToMarkdown('<blockquote>外层<blockquote>内层</blockquote></blockquote>');
  assert.ok(md.includes('> 外层'));
  assert.ok(md.includes('> > 内层'), `嵌套引用应保留: ${md}`);
});

test('render: hr', () => {
  assert.equal(richHtmlToMarkdown('<hr/>'), '---');
});

test('render: 未知标签保留可见文本、丢弃 tag', () => {
  // <foo> 内文本与两侧文本直接拼接（HTML 无空格语义）
  assert.equal(richHtmlToMarkdown('<p>a<foo bar="x">b</foo>c</p>'), 'abc');
});

test('render: div 内结构', () => {
  assert.equal(richHtmlToMarkdown('<div>一<p>二</p></div>'), '一\n\n二');
});

// ===== heading offset（§14.1.1 BLOCKER-6） =====

test('heading: answer body source h1 → H3，不破坏文档层级', () => {
  const md = richHtmlToMarkdown('<h1>大标题</h1>');
  assert.ok(md.startsWith('### 大标题'), 'h1 必须降级为 H3');
  assert.ok(!md.startsWith('# '), '不得出现 H1');
});

test('heading: 完整映射 h1→H3 h2→H4 h3→H5 h4-h6→H6', () => {
  const md = richHtmlToMarkdown('<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>');
  const headings = md.match(/^#{2,6} .*$/gm) || [];
  assert.deepEqual(headings, ['### a', '#### b', '##### c', '###### d', '###### e', '###### f']);
});

test('heading: heading 文本中的 Markdown 注入被转义', () => {
  const md = richHtmlToMarkdown('<h1>[click](https://evil.example)</h1>');
  assert.ok(md.startsWith('### '));
  // 原始锚文本不得成为 link label（[click] 被转义）；
  // 其中的裸 URL 走 §8.0.2 pipeline 生成 renderer 显式链接（允许）
  assert.ok(md.includes('\\[click\\]'), '锚文本必须被转义');
  assert.ok(!md.includes('[click](https://'), '不得保留原样注入链接');
  assert.ok(md.includes('[打开外部链接 · evil.example]'), '裸 URL 走显式链接');
});

// ===== inline code 安全（§12/§16） =====

test('inline-code: 普通代码', () => {
  assert.equal(richHtmlToMarkdown('<p>执行 <code>npm install</code></p>'), '执行 `npm install`');
});

test('inline-code: 内容含 backtick 时选择更长 delimiter（不 escape）', () => {
  const md = richHtmlToMarkdown('<p><code>a`b</code></p>');
  assert.equal(md, '``a`b``', '应使用双反引号包裹，内容 backtick 保留');
});

test('inline-code: 内容以 backtick 开头/结尾时加空格', () => {
  const md = richHtmlToMarkdown('<p><code>`x</code></p>');
  assert.ok(md.includes('`` `x` ``') || md.includes('`` `x ``'), `code span 内 backtick 安全: ${md}`);
});

// ===== fenced code 安全（§12.3 / §23.3 I） =====

test('fence: 普通代码块带 language', () => {
  const md = richHtmlToMarkdown('<pre><code class="language-bash">npm install x</code></pre>');
  assert.equal(md, '``` bash\nnpm install x\n```');
});

test('fence: 无 language → 裸 fence', () => {
  const md = richHtmlToMarkdown('<pre><code>plain</code></pre>');
  assert.equal(md, '```\nplain\n```');
});

test('fence: 代码含 ``` 时 fence 自适应加长（不可逃逸）', () => {
  const md = richHtmlToMarkdown('<pre><code>line1\n```\nline3</code></pre>');
  assert.ok(md.startsWith('````'), `fence 必须长于内容中最长反引号串: ${md}`);
  assert.ok(md.endsWith('````'), '闭合 fence 同样加长');
  assert.ok(md.includes('```\n'), '内容中的三重反引号保留在代码块内');
});

test('fence: 代码含更长的 ```` 反引号串', () => {
  const md = richHtmlToMarkdown('<pre><code>````\nx</code></pre>');
  assert.ok(md.startsWith('`````'), 'fence 必须比内容最长串更长');
});

test('fence: 恶意 language 被省略或仅保留安全子串', () => {
  // class 含换行 → 整体拒绝（防 language-bash\nrm -rf 注入）
  assert.equal(richHtmlToMarkdown('<pre><code class="language-bash\nrm -rf /">x</code></pre>'), '```\nx\n```');
  assert.equal(richHtmlToMarkdown('<pre><code class="language-<script>">x</code></pre>'), '```\nx\n```');
  // language-javascript:alert(1)：仅安全前缀 javascript 进入 language，`:alert(1)` 被丢弃
  const md = richHtmlToMarkdown('<pre><code class="language-javascript:alert(1)">x</code></pre>');
  assert.equal(md, '``` javascript\nx\n```');
  assert.ok(!md.includes('alert'), '注入内容不得进入 language');
});

test('fence: language 超长被省略', () => {
  const long = 'a'.repeat(41);
  const md = richHtmlToMarkdown(`<pre><code class="language-${long}">x</code></pre>`);
  assert.ok(md.startsWith('```\n'), '超长 language 必须省略');
});

test('fence: language 带换行/控制字符被省略', () => {
  // data-language 属性含换行 → 拒绝
  const md = richHtmlToMarkdown('<pre><code data-language="bash\nrm -rf">x</code></pre>');
  assert.ok(md.startsWith('```\n'), '含换行 language 必须省略');
});

test('fence: 代码内容本身只是数据（不执行）', () => {
  const md = richHtmlToMarkdown('<pre><code>rm -rf /</code></pre>');
  assert.ok(md.includes('rm -rf /'), '代码内容原样保留为纯文本');
});

test('longestBacktickRun 工具', () => {
  assert.equal(longestBacktickRun(''), 0);
  assert.equal(longestBacktickRun('abc'), 0);
  assert.equal(longestBacktickRun('a`b'), 1);
  assert.equal(longestBacktickRun('a```b'), 3);
  assert.equal(longestBacktickRun('``a``b'), 2);
});

// ===== 危险/主动 HTML（§14.3 / §18 / §23.3 G） =====

test('danger: script 完全丢弃（内容也不进入正文）', () => {
  const md = richHtmlToMarkdown('<p>前</p><script>fetch("https://evil.example")</script><p>后</p>');
  assert.ok(!md.includes('fetch'), 'script 内容必须完全丢弃');
  assert.ok(md.includes('前') && md.includes('后'));
});

test('danger: style 完全丢弃', () => {
  const md = richHtmlToMarkdown('<style>body{display:none}</style><p>正文</p>');
  assert.ok(!md.includes('display:none'));
  assert.ok(md.includes('正文'));
});

test('danger: 无 raw HTML passthrough（script/style/form/input/button/iframe/object/embed）', () => {
  const html = [
    '<script>alert(1)</script>',
    '<style>.x{}</style>',
    '<form action="https://evil.example"><input name="x"/></form>',
    '<button onclick="steal()">按钮</button>',
    '<iframe src="https://evil.example"></iframe>',
    '<object data="x"></object>',
    '<embed src="x"/>',
  ].join('');
  const md = richHtmlToMarkdown(html);
  assert.ok(!/<(script|style|form|input|button|iframe|object|embed)\b/i.test(md), '不得残留主动 HTML tag');
  assert.ok(!/on\w+\s*=/i.test(md), '不得残留 event handler');
  assert.ok(!/style\s*=/i.test(md), '不得残留 style 属性');
});

test('danger: 表单可见文本可保留（button 文字）', () => {
  const md = richHtmlToMarkdown('<p>点击 <button>提交</button> 完成</p>');
  assert.ok(md.includes('提交'), '按钮可见文本应保留');
  assert.ok(!md.includes('<button'), '不得残留 button tag');
});

test('danger: img onerror / a onclick 不产生任何事件行为', () => {
  const md = richHtmlToMarkdown('<img src="x" onerror="alert(1)"/><a href="https://evil.example" onclick="x()">文字</a>');
  assert.ok(!/onerror|onclick/i.test(md));
  assert.ok(!md.includes('<img'), 'img 不得 raw 输出');
});

test('danger: 最终 Markdown 无任何 <tag 形态', () => {
  const html = '<p>a</p><div style="color:red">b</div><span onclick="x">c</span>';
  const md = richHtmlToMarkdown(html);
  assert.ok(!/<[a-z]+\b/i.test(md), '无 raw HTML passthrough');
});

// ===== malformed HTML（§23.3 H） =====

test('malformed: 未闭合 tag 不 crash 不透传', () => {
  const md = richHtmlToMarkdown('<p>未闭合<div>内容');
  assert.ok(md.length > 0);
  assert.ok(!/<[a-z]+\b/i.test(md));
});

test('malformed: 错误嵌套由 parser 容错，不 crash', () => {
  const md = richHtmlToMarkdown('<b><i>x</b>y');
  assert.ok(!/<[a-z]+\b/i.test(md));
  assert.ok(md.includes('x') && md.includes('y'));
});

test('malformed: code 中类似 HTML 的文字是纯文本', () => {
  const md = richHtmlToMarkdown('<pre><code>&lt;div&gt;hello&lt;/div&gt;</code></pre>');
  assert.ok(md.includes('<div>hello</div>'), '代码内 HTML 文字应作为代码文本保留');
  assert.ok(md.startsWith('```'), '应为 fenced block');
});

test('malformed: 空输入/纯文本输入', () => {
  assert.equal(richHtmlToMarkdown(''), '');
  assert.equal(richHtmlToMarkdown(null), '');
  assert.equal(richHtmlToMarkdown('纯文本'), '纯文本');
});

// ===== 链接 pipeline（§8.2 / §11） =====

test('link: 合法 https 外链 → 明示域名，anchor 文本保留', () => {
  const md = richHtmlToMarkdown('<p><a href="https://github.com/foo">GitHub 仓库</a></p>');
  assert.ok(md.includes('原文链接文字：GitHub 仓库'), '锚文本应保留');
  assert.ok(md.includes('[打开外部链接 · github.com](https://github.com/foo)'), '应生成明确链接');
});

test('link: 危险 href → 仅保留锚文本，不生成链接', () => {
  const md = richHtmlToMarkdown('<p><a href="javascript:alert(1)">点击</a></p>');
  assert.ok(md.includes('原文链接文字：点击'), '锚文本保留');
  assert.ok(!md.includes('](javascript:'), '不得生成危险链接');
  assert.ok(!md.includes('[打开外部链接'), '不得生成打开链接');
});

test('link: link.zhihu.com redirect → 链接指向解包后的 target', () => {
  const md = richHtmlToMarkdown('<p><a href="https://link.zhihu.com/?target=https%3A%2F%2Fgithub.com%2Ffoo">原文</a></p>');
  assert.ok(md.includes('[打开外部链接 · github.com](https://github.com/foo)'), `应解包 redirect: ${md}`);
});

test('link: 裸 URL 走 sanitizer 生成显式链接（不依赖 autolink）', () => {
  const md = richHtmlToMarkdown('<p>访问 https://example.com 了解</p>');
  assert.ok(md.includes('[打开外部链接 · example.com](https://example.com/)'), `裸 URL 应生成显式链接: ${md}`);
});

test('link: 危险裸 URL → 惰性文本不成为链接', () => {
  const md = richHtmlToMarkdown('<p>javascript:alert(1) 和 https://localhost/x</p>');
  assert.ok(!md.includes('](javascript:'), '危险 scheme 不得成链');
  assert.ok(!md.includes('](https://localhost'), 'localhost 不得成链');
});

// ===== 图片 Phase 1 fallback（§19） =====

test('image: inert 占位，不自动加载、不产生 href', () => {
  const md = richHtmlToMarkdown('<p><img src="https://picx.zhimg.com/abc.jpg"/></p>');
  assert.ok(md.includes('[图片]'), '应输出 inert 占位');
  assert.ok(!md.includes('!['), '不得生成 Markdown image');
  assert.ok(!md.includes('](https://picx.zhimg.com'), '不得生成远程 href');
});

test('image: alt 作为安全文本保留', () => {
  const md = richHtmlToMarkdown('<img alt="示意图 [x]" src="https://x/y.png"/>');
  assert.ok(md.includes('[图片：示意图 \\[x\\]]') || md.includes('[图片：示意图'), 'alt 保留且被转义');
  assert.ok(!md.includes('![示意图'), '不得成为 image 语法');
});

test('image: figure + figcaption 保留 caption', () => {
  const md = richHtmlToMarkdown('<figure><img src="https://x/y.png"/><figcaption>数据来源</figcaption></figure>');
  assert.ok(md.includes('[图片]'));
  assert.ok(md.includes('数据来源'), 'caption 应保留');
});

// ===== 脚注重建（§13.1 BLOCKER-5 / §23.3.3，Phase 2） =====

test('footnote: 无 answerId → fail closed 为可见文本（Phase 1 fallback 保留）', () => {
  const md = richHtmlToMarkdown('<p>正文<sup data-numero="1" data-text="来源">[1]</sup></p>');
  assert.ok(!md.includes('[^'), '无 answerId 不得重建 footnote reference 语法');
  assert.ok(!md.includes('data-text'), '不得透传属性');
  assert.ok(!md.includes('<sup'), '不得残留 tag');
});

test('footnote: 合法 answerId → 内部 ID + 定义；data-numero 不进 identifier', () => {
  const md = richHtmlToMarkdown('<p>正文<sup data-numero="7" data-text="来源 A">[7]</sup>继续</p>', { answerId: '206123' });
  assert.ok(md.includes('正文[^a206123-r1]继续'), `marker 应为内部 ID: ${md}`);
  assert.ok(md.includes('[^a206123-r1]: 来源 A'), '定义应输出');
  assert.ok(!md.includes('-r7'), 'data-numero 不得进入 identifier');
  assert.ok(!md.includes('<sup'), '不得残留 tag');
});

test('footnote: 重复 numero → 按出现顺序 r1/r2，不影响完整性', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="A">[1]</sup> <sup data-numero="1" data-text="B">[1]</sup></p>',
    { answerId: '1' },
  );
  assert.ok(md.includes('[^a1-r1]'));
  assert.ok(md.includes('[^a1-r2]'));
  assert.ok(md.includes('[^a1-r1]: A'));
  assert.ok(md.includes('[^a1-r2]: B'));
  // 只数正文 marker（定义行 [^id]: 不算），避免定义文本重复计数
  assert.equal((md.match(/\[\^a1-r\d+\](?!:)/g) || []).length, 2, '恰好两个 marker');
});

test('footnote: 非法 numero（负数/超长/Markdown 字符）不影响完整性', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="-3" data-text="负">[-3]</sup><sup data-numero="99999999999999999999" data-text="长">[x]</sup><sup data-numero="a]b" data-text="文">[y]</sup></p>',
    { answerId: '42' },
  );
  assert.ok(md.includes('[^a42-r1]: 负'));
  assert.ok(md.includes('[^a42-r2]: 长'));
  assert.ok(md.includes('[^a42-r3]: 文'));
  assert.ok(!md.includes('[-3]'), '原 sup 文本不进入产物');
});

test('footnote: 缺失 numero（仅 data-text）仍按脚注处理', () => {
  const md = richHtmlToMarkdown('<p><sup data-text="只有文本">[1]</sup></p>', { answerId: '5' });
  assert.ok(md.includes('[^a5-r1]: 只有文本'));
});

test('footnote: 缺失 data-text → 空定义不 crash', () => {
  const md = richHtmlToMarkdown('<p><sup data-numero="3">[3]</sup></p>', { answerId: '5' });
  assert.ok(md.includes('[^a5-r1]:'), '空脚注定义仍输出');
  assert.ok(!md.includes('a5-r3'), 'data-numero=3 不进 identifier');
});

test('footnote: 普通 sup（无 data-numero/data-text）只渲染可见文本', () => {
  const md = richHtmlToMarkdown('<p>E=mc<sup>2</sup></p>', { answerId: '1' });
  assert.equal(md, 'E=mc2');
});

test('footnote: sub 不是脚注元素（§14.1 白名单只有 sup[data-numero]），保持 Phase 1 可见文本', () => {
  const md = richHtmlToMarkdown('<p>H<sub data-numero="1" data-text="x">2</sub>O</p>', { answerId: '1' });
  assert.ok(!md.includes('[^'), 'sub 不得生成 footnote 语法');
  assert.ok(!md.includes('<sub'), '不得残留 tag');
  assert.ok(md.includes('H2O'), '可见文本保留');
});

test('footnote: 非法 answerId → fail closed 为可见文本', () => {
  const md = richHtmlToMarkdown('<p>a<sup data-numero="1" data-text="x">[1]</sup></p>', { answerId: 'a1' });
  assert.ok(!md.includes('[^'), '非数字 answerId 不得重建（无法保证文档级唯一）');
});

test('footnote: data-text Markdown 注入被转义，不产生假链接/标题', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="[click](https://evil.example) 和 # 标题">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]:'), '定义存在');
  assert.ok(!md.includes('[click](https://'), '不得保留假链接');
  assert.ok(!/^#\s/m.test(md), '不得产生 heading');
});

test('footnote: 恶意脚注 URL（localhost/javascript）→ 惰性文本', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="https://localhost/x 和 javascript:alert(1)">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(!md.includes('](https://localhost'), 'localhost 不得成链');
  assert.ok(!md.includes('](javascript:'), 'javascript 不得成链');
});

test('footnote: 脚注内合法公网 URL → clickable + 明示域名（external_unverified）', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="来源 https://github.com/foo">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[打开外部链接 · github.com]'), '脚注内链接明示域名');
  assert.ok(md.includes('(https://github.com/foo)'), '链接指向公网 target');
});

// ===== P1-3: 脚注 data-url 合同（§13 真实形态 data-text + data-url + data-numero） =====

test('footnote-dataurl: 公网 https data-url → sanitized clickable link + 明示域名', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="来源" data-url="https://github.com/example">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]: 来源 [打开外部链接 · github.com](https://github.com/example)'), `定义含 text+URL: ${md}`);
  assert.ok(!md.includes('data-url'), '不得透传属性');
});

test('footnote-dataurl: localhost data-url → 无 href（inert）', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="来源" data-url="https://localhost/x">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]: 来源'), '脚注定义仍输出');
  assert.ok(!md.includes('](https://localhost'), 'localhost 不得成链');
  assert.ok(!md.includes('[打开外部链接'), '被拒 URL 不生成打开链接');
});

test('footnote-dataurl: javascript: data-url → 无 href（inert）', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="来源" data-url="javascript:alert(1)">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]: 来源'), '脚注定义仍输出');
  assert.ok(!md.includes('](javascript:'), 'javascript 不得成链');
  assert.ok(!md.includes('[打开外部链接'), '被拒 URL 不生成打开链接');
});

test('footnote-dataurl: file: data-url → 无 href（inert）', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="来源" data-url="file:///etc/passwd">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]: 来源'), '脚注定义仍输出');
  assert.ok(!md.includes('](file:'), 'file: 不得成链');
  assert.ok(!md.includes('[打开外部链接'), '被拒 URL 不生成打开链接');
});

test('footnote-dataurl: 恶意 data-text + 合法 data-url → text escaped + URL sanitized', () => {
  const md = richHtmlToMarkdown(
    '<p><sup data-numero="1" data-text="[click](https://evil.example) 和 # 标题" data-url="https://github.com/foo">[1]</sup></p>',
    { answerId: '9' },
  );
  assert.ok(md.includes('[^a9-r1]:'), '定义存在');
  assert.ok(!md.includes('[click](https://evil.example'), 'data-text 注入不得成链');
  assert.ok(!/^#\s/m.test(md), '不得产生 heading');
  assert.ok(md.includes('[打开外部链接 · github.com](https://github.com/foo)'), 'data-url 经 sanitizer 放行并明示域名');
});

test('footnote-dataurl: invalid/empty data-url → 脚注仍安全、不中断', () => {
  for (const bad of ['', 'not a url', 'https://']) {
    const md = richHtmlToMarkdown(
      `<p><sup data-numero="1" data-text="注" data-url="${bad}">[1]</sup></p>`,
      { answerId: '9' },
    );
    assert.ok(md.includes('[^a9-r1]: 注'), `data-url=${JSON.stringify(bad)} 脚注仍渲染`);
    assert.ok(!md.includes('[打开外部链接'), '非法 URL 不放行');
  }
});

test('footnote: 跨 answer 无 collision；V1 framing 恰好一个 ## N. 每条', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: 2, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: '1', author: 'A', content: '<p>a<sup data-text="脚注一" data-numero="1">[1]</sup></p>', voteupCount: 1, commentCount: 0 },
    { id: '2', author: 'B', content: '<p>b<sup data-text="脚注二" data-numero="1">[1]</sup></p>', voteupCount: 1, commentCount: 0 },
  ];
  const md = renderAnswers(meta, answers);
  assert.ok(md.includes('[^a1-r1]'));
  assert.ok(md.includes('[^a2-r1]'));
  assert.ok(md.includes('[^a1-r1]: 脚注一'));
  assert.ok(md.includes('[^a2-r1]: 脚注二'));
  const ids = md.match(/\[\^a\d+-r\d+\](?!:)/g) || [];
  assert.equal(new Set(ids).size, ids.length, `所有内部 ID 全局唯一: ${md}`);
  const headings = md.match(/^## \d+\./gm) || [];
  assert.equal(headings.length, 2, 'V1 framing 不破坏');
});

test('footnote: 同一 HTML 两次渲染结果一致（G9 determinism，无跨调用状态泄漏）', () => {
  const html = '<p>a<sup data-text="x" data-numero="1">[1]</sup>b<sup data-text="y" data-numero="2">[2]</sup></p>';
  const first = richHtmlToMarkdown(html, { answerId: '1' });
  const second = richHtmlToMarkdown(html, { answerId: '1' });
  assert.equal(first, second, '两次调用输出必须一致');
  assert.equal((first.match(/\[\^a1-r\d+\](?!:)/g) || []).length, 2, '每次调用独立从 r1 开始');
});

// ===== answer framing（§23.3 J / §24） =====

test('framing: 正文 ## 999. 不能增加 verifier 记录数', () => {
  const meta = { questionId: '123', questionTitle: '题目', answerCount: 1, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: '1', author: '作者', content: '<p>正文</p><h2>## 999. fake</h2><p>结束</p>', voteupCount: 1, commentCount: 0 },
  ];
  const md = renderAnswers(meta, answers);
  // verifier 用 /^## \d+\./gm 计数 —— 正文中的 ## 999. 必须被 escape/降级，不匹配该模式
  const answerHeadings = md.match(/^## \d+\./gm) || [];
  assert.equal(answerHeadings.length, 1, `只能有一个 answer heading: ${md}`);
  assert.equal(answerHeadings[0], '## 1.');
});

test('framing: author 注入 ## N. 不影响记录数', () => {
  const meta = { questionId: '123', questionTitle: '题目', answerCount: 2, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: '1', author: '## 999. fake', content: '<p>x</p>', voteupCount: 2, commentCount: 0 },
    { id: '2', author: 'B', content: '<p>y</p>', voteupCount: 1, commentCount: 0 },
  ];
  const md = renderAnswers(meta, answers);
  const answerHeadings = md.match(/^## \d+\./gm) || [];
  assert.equal(answerHeadings.length, 2, '两条回答恰好两个 heading');
  assert.deepEqual(answerHeadings, ['## 1.', '## 2.']);
});

test('framing: questionTitle 注入 link 不产生主动链接', () => {
  const meta = { questionId: '123', questionTitle: '[click](https://evil.example)', answerCount: 1, url: 'https://www.zhihu.com/question/123' };
  const answers = [{ id: '1', author: 'A', content: '<p>x</p>', voteupCount: 1, commentCount: 0 }];
  const md = renderAnswers(meta, answers);
  assert.ok(!md.includes('](https://evil.example'), '题目不得产生主动链接');
  assert.ok(md.includes('# \\[click\\]'), '题目文本保留且被转义');
});

test('framing: 常规渲染保持 V1 结构', () => {
  const meta = { questionId: '123', questionTitle: '测试问题', answerCount: 2, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: 'a1', author: 'B', voteupCount: 5, commentCount: 1, content: '<p>low</p>' },
    { id: 'a2', author: 'A', voteupCount: 99, commentCount: 3, content: '<p>high</p>' },
  ];
  const md = renderAnswers(meta, answers);
  assert.ok(md.includes('# 测试问题'));
  assert.ok(md.includes('共 2 条回答'));
  const highIdx = md.indexOf('high');
  const lowIdx = md.indexOf('low');
  assert.ok(highIdx !== -1 && lowIdx !== -1 && highIdx < lowIdx, '高赞在前');
  assert.ok(!md.includes('<p>'), '无 HTML 标签');
});

test('framing: 正文 h2 不能等于 answer heading（### 以下）', () => {
  const md = renderAnswers(
    { questionId: '1', questionTitle: 'T', answerCount: 1, url: 'https://www.zhihu.com/question/1' },
    [{ id: '9', author: 'A', content: '<h2>子标题</h2>', voteupCount: 1, commentCount: 0 }],
  );
  assert.ok(md.includes('#### 子标题'), '正文 h2 必须降级为 H4，不得为 ## N. 形态');
});

test('framing: 正文列表/引用/粗体结构正常渲染且不伪造 heading', () => {
  const md = renderAnswers(
    { questionId: '1', questionTitle: 'T', answerCount: 1, url: 'https://www.zhihu.com/question/1' },
    [{ id: '9', author: 'A', content: '<ul><li>项</li></ul><blockquote>引</blockquote>', voteupCount: 1, commentCount: 0 }],
  );
  assert.ok(md.includes('- 项'));
  assert.ok(md.includes('> 引'));
  const headings = md.match(/^## \d+\./gm) || [];
  assert.equal(headings.length, 1);
});

// ===== P1-1: 多行 payload 经 renderer 不产生行级结构 =====

test('P1-1: richHtmlToMarkdown 多行 text 不产生 Setext heading / indented code', () => {
  const md = richHtmlToMarkdown('<p>foo\n===\n\nfoo\n\n    indented-code\n\nfoo\n\tindented-code</p>');
  assert.ok(!/^=+\s*$/m.test(md), 'Setext underline 行不得出现');
  assert.ok(!/^ {4}\S/m.test(md), '4 空格缩进代码行不得出现');
  assert.ok(!/^\t\S/m.test(md), 'Tab 缩进代码行不得出现');
  assert.ok(md.includes('foo'), '正文文本保留');
});

test('P1-1: richHtmlToMarkdown 段落内 Setext 注入被中和', () => {
  const md = richHtmlToMarkdown('<p>标题文字\n===</p>');
  assert.ok(!/^=+\s*$/m.test(md), '不得产生 Setext H1 underline');
  assert.ok(!md.includes('\n==='), '不得残留未转义 === 行');
});

// ===== P1-1 cross-node：结构被 inline tag / <br> 分段（跨 DOM text node） =====

test('P1-1-crossnode: foo<br>=== 不产生 Setext H1', () => {
  const md = richHtmlToMarkdown('<p>foo<br>===</p>');
  assert.ok(!/^=+\s*$/m.test(md), '不得产生 Setext underline 行');
  assert.ok(!md.includes('\n==='), '不得拼回未转义 === 行');
  assert.ok(md.includes('\\==='), '=== 必须被转义');
  assert.ok(md.includes('foo'), '正文保留');
});

test('P1-1-crossnode: foo<br>4空格缩进 不产生 indented code block', () => {
  const md = richHtmlToMarkdown('<p>foo<br>    injected</p>');
  assert.ok(!/^ {4}\S/m.test(md), '4 空格缩进代码行不得出现');
  assert.ok(md.includes('\u00A0   injected'), '前导空格被中和为 NBSP');
  assert.ok(md.includes('injected'), '文本保留');
});

test('P1-1-crossnode: foo<br>Tab缩进 不产生 indented code block', () => {
  const md = richHtmlToMarkdown('<p>foo<br>\tinjected</p>');
  assert.ok(!/^\t\S/m.test(md), 'Tab 缩进代码行不得出现');
  assert.ok(md.includes('\u00A0injected'), 'Tab 被中和为 NBSP');
});

test('P1-1-crossnode: span 分段 <span>foo</span><br><span>===</span>', () => {
  const md = richHtmlToMarkdown('<p><span>foo</span><br><span>===</span></p>');
  assert.ok(!/^=+\s*$/m.test(md), '不得产生 Setext underline');
  assert.ok(!md.includes('\n==='), '不得拼回未转义 ===');
  assert.ok(md.includes('foo'), '正文保留');
});

test('P1-1-crossnode: strong 包裹的 === 不泄漏结构边界（**===** 内不得成 underline）', () => {
  const md = richHtmlToMarkdown('<p>foo<br><strong>===</strong></p>');
  assert.ok(!/^=+\s*$/m.test(md), '不得产生 Setext underline');
  assert.ok(md.includes('**\\===**'), '=== 在 renderer 生成的 bold 结构内被转义');
  assert.ok(!md.includes('\n==='), '不得拼回未转义 ===');
});

test('P1-1-crossnode: 组合注入全部惰性化且正文可读', () => {
  const md = richHtmlToMarkdown('<p>foo<br>===<br>    a<br>\tb</p>');
  assert.ok(!/^=+\s*$/m.test(md), '无 Setext underline');
  assert.ok(!/^ {4}\S/m.test(md), '无 4 空格缩进代码行');
  assert.ok(!/^\t\S/m.test(md), '无 Tab 缩进代码行');
  assert.ok(md.includes('foo') && md.includes('a') && md.includes('b'), '正文保留');
});

// ===== P1-1 split-whitespace：缩进空白跨多个 DOM text node 累计 =====

test('P1-1-split: 2+2 空格跨节点不累计成 4 空格缩进', () => {
  const md = richHtmlToMarkdown('<p>foo<br><span>  </span><span>  injected</span></p>');
  assert.ok(!/^ {4}\S/m.test(md), '不得形成 4 空格缩进代码行');
  assert.ok(!/^\t\S/m.test(md), '不得形成 Tab 缩进代码行');
  assert.ok(md.includes('injected'), '正文保留');
});

test('P1-1-split: 3+1 空格跨节点不累计成 4 空格缩进', () => {
  const md = richHtmlToMarkdown('<p>foo<br>   <span> injected</span></p>');
  assert.ok(!/^ {4}\S/m.test(md), '不得形成 4 空格缩进代码行');
  assert.ok(!/^\t\S/m.test(md), '不得形成 Tab 缩进代码行');
  assert.ok(md.includes('injected'), '正文保留');
});

test('P1-1-split: 1+1+1+1 空格跨节点不累计成 4 空格缩进', () => {
  const md = richHtmlToMarkdown('<p>foo<br><span> </span><span> </span><span> </span><span> injected</span></p>');
  assert.ok(!/^ {4}\S/m.test(md), '不得形成 4 空格缩进代码行');
  assert.ok(!/^\t\S/m.test(md), '不得形成 Tab 缩进代码行');
  assert.ok(md.includes('injected'), '正文保留');
});

test('P1-1-split: 多空格纯空白节点（4 个 1 空格 span 拼接）不形成缩进行', () => {
  const md = richHtmlToMarkdown('<p>foo<br><span> </span><span> </span><span> </span><span> </span>injected</p>');
  assert.ok(!/^ {4}\S/m.test(md), '纯空白节点累计也不得形成缩进行');
  assert.ok(md.includes('injected'), '正文保留');
});

test('P1-1-split: 正常 inline spacing 保持可读（不丢失词间隔）', () => {
  const md = richHtmlToMarkdown('<p>Hello <strong>world</strong> again</p>');
  // "Hello "（尾空格保留）+ **world** + " again"（leading 空格 → NBSP，视觉等同空格）
  assert.equal(md, 'Hello **world**\u00A0again');
  assert.ok(md.includes('Hello **world**'), 'strong 结构保留');
  assert.ok(md.includes('\u00A0again'), '词间分隔保留（NBSP 视觉等同空格）');
});

test('P1-1: questionTitle 多行 Setext payload 不产生额外 heading', () => {
  const meta = { questionId: '123', questionTitle: 'foo\n===', answerCount: 1, url: 'https://www.zhihu.com/question/123' };
  const answers = [{ id: '1', author: 'A', content: '<p>x</p>', voteupCount: 1, commentCount: 0 }];
  const md = renderAnswers(meta, answers);
  const headings = md.match(/^#{1,6} /gm) || [];
  // 只有 renderer 生成的 `# foo`（标题行）与 `## 1.`（answer heading）
  assert.equal(headings.length, 2, `不得产生 Setext 伪 heading: ${md}`);
  assert.ok(!/^=+\s*$/m.test(md), '=== 行不得成为 underline');
});

test('P1-1: author 多行 payload 不产生额外 heading', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: 1, url: 'https://www.zhihu.com/question/123' };
  const answers = [{ id: '1', author: 'bar\n---', content: '<p>x</p>', voteupCount: 1, commentCount: 0 }];
  const md = renderAnswers(meta, answers);
  const headings = md.match(/^## \d+\./gm) || [];
  assert.equal(headings.length, 1, `author 不得产生额外 answer heading: ${md}`);
  // author 中的 --- 必须被转义（\-\-\-）且与计数文本同处一行，不得成为独立 Setext underline
  assert.ok(md.includes('bar\n\\-\\-\\- —'), `author 中的 --- 必须转义: ${md}`);
  assert.ok(!/^\\-\\-\\-\s*$/m.test(md), '转义后的 --- 行不得以独立行形态出现');
});

// ===== P1-2: framing link / scalar metadata 收口 =====

test('P1-2: meta.url 恶意值不进入 Markdown（链接由 questionId 确定性构造）', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: 1, url: 'https://evil.example' };
  const answers = [{ id: '1', author: 'A', content: '<p>x</p>', voteupCount: 1, commentCount: 0 }];
  const md = renderAnswers(meta, answers);
  assert.ok(!md.includes('evil.example'), 'meta.url 不得进入产物');
  assert.ok(md.includes('[知乎问题](https://www.zhihu.com/question/123)'), '链接由 questionId 确定性构造');
});

test('P1-2: answer.url 恶意值不进入 Markdown（链接由 questionId+answerId 构造）', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: 1, url: 'https://www.zhihu.com/question/123' };
  const answers = [{ id: '1', author: 'A', url: 'https://evil.example/phishing', content: '<p>x</p>', voteupCount: 1, commentCount: 0 }];
  const md = renderAnswers(meta, answers);
  assert.ok(!md.includes('evil.example'), 'answer.url 不得进入产物');
  assert.ok(md.includes('[知乎回答](https://www.zhihu.com/question/123/answer/1)'), '链接由 ID 确定性构造');
});

test('P1-2: scalar metadata 异常字符串不制造 Markdown 结构', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: '999. fake', url: 'https://x' };
  const answers = [
    { id: '1', author: 'A', content: '<p>x</p>', voteupCount: '1. fake', commentCount: '- fake' },
  ];
  const md = renderAnswers(meta, answers);
  assert.ok(!md.includes('999. fake'), 'answerCount 异常值不得进入');
  assert.ok(!md.includes('1. fake'), 'voteupCount 异常值不得进入');
  assert.ok(!md.includes('- fake'), 'commentCount 异常值不得进入');
  assert.ok(md.includes('(未知)'), 'answerCount 异常 → 安全 placeholder');
  const headings = md.match(/^## \d+\./gm) || [];
  assert.equal(headings.length, 1, '不得产生额外 heading');
  assert.ok(!/^## 1\. .*1\. fake/.test(md), 'voteupCount 不得形成序号结构');
});

test('P1-2: scalar metadata 正常数字显示语义不变', () => {
  const meta = { questionId: '123', questionTitle: 'T', answerCount: 2, url: 'https://www.zhihu.com/question/123' };
  const answers = [
    { id: '1', author: 'A', content: '<p>x</p>', voteupCount: 99, commentCount: 3 },
    { id: '2', author: 'B', content: '<p>y</p>', voteupCount: 5, commentCount: 1 },
  ];
  const md = renderAnswers(meta, answers);
  assert.ok(md.includes('共 2 条回答'));
  assert.ok(md.includes('99 赞 · 3 评论'));
  const highIdx = md.indexOf('x');
  const lowIdx = md.indexOf('y');
  assert.ok(highIdx !== -1 && lowIdx !== -1 && highIdx < lowIdx, '高赞在前');
});
