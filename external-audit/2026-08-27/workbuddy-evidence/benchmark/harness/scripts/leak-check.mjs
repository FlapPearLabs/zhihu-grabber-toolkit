// Quick leak check over all result artifacts.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('benchmark/results');
const files = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json')) files.push(p); } }
walk(dir);

const SENSITIVE = /cookie|secret|token|password|credential|api[_-]?key|authorization|bearer/i;
const PRIVATE_PATH = /[a-zA-Z]:\\\\|D:[\\\\/]Dev|C:[\\\\/]Users|\.workbuddy/i;
let bad = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  if (SENSITIVE.test(s)) { console.log('SENSITIVE_HIT', f); bad++; }
  if (PRIVATE_PATH.test(s)) { console.log('PRIVATE_PATH_HIT', f); bad++; }
}
console.log(bad === 0 ? 'LEAK_CHECK_PASS files=' + files.length : 'LEAK_CHECK_FAIL');
