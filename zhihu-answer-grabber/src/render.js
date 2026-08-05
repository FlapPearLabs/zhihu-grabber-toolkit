const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/** 剥离 HTML 标签、解码常见实体、折叠空白 */
export function stripHtml(html) {
  if (html == null) return '';
  let text = String(html)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    text = text.split(entity).join(char);
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fmtTime(unix) {
  if (!unix) return '(未知)';
  const d = new Date(unix * 1000);
  return Number.isNaN(d.getTime()) ? '(未知)' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/** 生成可读 Markdown：题目信息 + 按赞数倒序的回答全文 */
export function renderAnswers(meta, answers) {
  const lines = [];
  lines.push(`# ${meta.questionTitle || `问题 ${meta.questionId}`}`);
  lines.push('');
  lines.push(`> 问题链接: ${meta.url}`);
  lines.push(`> 抓取时间: ${meta.fetchedAt || new Date().toISOString()}`);
  lines.push(`> 问题回答总数: ${meta.answerCount ?? '(未知)'}，本次抓取到: 共 ${answers.length} 条回答`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const sorted = [...answers].sort((a, b) => (b.voteupCount ?? 0) - (a.voteupCount ?? 0));
  sorted.forEach((a, i) => {
    lines.push(`## ${i + 1}. ${a.author || '(匿名)'} — ${a.voteupCount ?? 0} 赞 · ${a.commentCount ?? 0} 评论`);
    lines.push('');
    lines.push(`- 链接: ${a.url}`);
    lines.push(`- 创建时间: ${fmtTime(a.createdTime)}`);
    lines.push('');
    lines.push(stripHtml(a.content));
    lines.push('');
    lines.push('---');
    lines.push('');
  });
  return lines.join('\n');
}
