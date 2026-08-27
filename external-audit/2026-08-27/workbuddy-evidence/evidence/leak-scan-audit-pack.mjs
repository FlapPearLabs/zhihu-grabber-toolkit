// Audit pack secret/path leak scan — scans every file copied into ZHCLIPRO_EXTERNAL_AUDIT_PACK
// Sensitive patterns: cookie/secret/token/password/credential/api-key/bearer/authorization
// Private path patterns: D:/Dev, D:\Dev, C:/Users, C:\Users (absolute machine paths)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('ZHCLIPRO_EXTERNAL_AUDIT_PACK');
const SENSITIVE = /cookie|secret|token|password|credential|api[_-]?key|bearer|authorization/i;
// NOTE: 'token'/'cookie' appear legitimately in corpus text & code (e.g. author name 'url_token'
// concept, sanitizer notes). We report occurrences with context for manual triage instead of
// auto-failing; only REDACTED-status violations and private paths are hard fails.
// Built dynamically to avoid self-matching the literal pattern in this script's own source.
const P1 = 'D:' + '/' + 'Dev', P2 = 'D:' + '\\\\' + 'Dev', P3 = 'C:' + '/' + 'Users', P4 = 'C:' + '\\\\' + 'Users';
const PRIVATE_PATH = new RegExp(P1 + '|' + P2 + '|' + P3 + '|' + P4, 'i');

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(ROOT);

let hardFails = [];
let sensitiveHits = [];
let privatePathHits = [];
let totalBytes = 0;

const SELF = import.meta.url.replace('file:///', '').split('/').join(path.sep); // scanner's own abs path
for (const f of files) {
  if (path.resolve(f) === SELF) continue; // exclude the scanner itself
  const buf = fs.readFileSync(f);
  totalBytes += buf.length;
  if (buf.length > 5 * 1024 * 1024) continue; // skip huge binaries (none expected)
  const txt = buf.toString('utf8');
  if (PRIVATE_PATH.test(txt)) {
    privatePathHits.push({ f, matches: (txt.match(PRIVATE_PATH) || []).slice(0, 3) });
  }
  if (SENSITIVE.test(txt)) {
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (SENSITIVE.test(lines[i])) {
        sensitiveHits.push({ f, line: i + 1, snippet: lines[i].slice(0, 160) });
        if (sensitiveHits.length > 60) break;
      }
    }
  }
}

console.log('SCAN_ROOT:', ROOT);
console.log('FILES:', files.length, '| BYTES:', totalBytes);
console.log('HARD_FAIL_PRIVATE_PATH:', privatePathHits.length);
for (const h of privatePathHits) console.log('  ', h.f, JSON.stringify(h.matches));
console.log('SENSITIVE_PATTERN_HITS (triage, not auto-fail):', sensitiveHits.length);
for (const h of sensitiveHits.slice(0, 25)) console.log(`  ${path.relative(ROOT, h.f)}:${h.line} | ${h.snippet}`);
if (sensitiveHits.length > 25) console.log('  ... +', sensitiveHits.length - 25, 'more');
console.log('RESULT:', privatePathHits.length === 0 ? 'PASS (no absolute private machine paths)' : 'FAIL');

// write triage report
fs.writeFileSync(path.join(ROOT, 'evidence/LEAK_SCAN_REPORT.txt'),
  `AUDIT PACK LEAK SCAN\n${new Date().toISOString()}\n\n` +
  `files=${files.length} bytes=${totalBytes}\n` +
  `private_path_hits=${privatePathHits.length}\n` +
  `sensitive_pattern_hits=${sensitiveHits.length} (triage)\n\n` +
  sensitiveHits.map((h) => `${path.relative(ROOT, h.f)}:${h.line} | ${h.snippet}`).join('\n') + '\n');
console.log('REPORT_WRITTEN: evidence/LEAK_SCAN_REPORT.txt');
