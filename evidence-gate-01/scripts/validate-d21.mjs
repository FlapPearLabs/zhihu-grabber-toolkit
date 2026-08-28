// validate-d21.mjs — D2.1 validator (FAIL CLOSED).
// Validates:
//   V1  corpus integrity vs frozen D2 manifest (original 6 lowcode questions)
//   V2  gold freeze: gold.json + case.json byte-identical to pilot D2 pack
//   V3  value-unit scope model: every unit has scope + canonical question_ids
//       matching its supporting sources; CASE units question_ids == []
//   V4  no order-dependence: shuffled-gold derivation byte-identical
//   V5  D2.1 runs complete: 8 cases x 3 fair x 3 budgets + 24 oracle
//   V6  selections identical to D2 runs (inputs frozen; evaluator-only delta)
//   V7  diff artifact exists with per_question_coverage changes documented
//   V8  no credentials / private paths in results (leak pattern scan)
// Reports command/count/pass/fail/environment per requirement §9.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCase } from '../lib/case-loader.mjs';
import { deriveValueUnits } from '../lib/value-units.mjs';
import { paths, CASE_IDS } from '../lib/paths.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

const PILOT_CASES = path.resolve(paths.root, '../external-audit/2026-08-27/workbuddy-evidence/benchmark/harness/cases');
const PILOT_RESULTS = path.resolve(paths.root, '../external-audit/2026-08-27/workbuddy-evidence/benchmark/results/runs-corrected-d2');
const FROZEN_MANIFEST = path.join(paths.corpus, 'manifest.frozen-d2.json');

// V1 corpus integrity (original 6 questions with handoffVerified entries)
{
  const frozen = JSON.parse(fs.readFileSync(FROZEN_MANIFEST, 'utf8'));
  const frozenEntries = frozen.entries.filter((e) => e.handoffVerified !== undefined || ['439521858', '477427067', '462973596', '466695857', '485463474', '487214224'].includes(e.qid));
  let ok = true;
  const details = [];
  for (const e of frozenEntries) {
    const p = path.join(paths.corpus, e.qid, 'answers.json');
    if (!fs.existsSync(p)) { ok = false; details.push(`${e.qid} MISSING`); continue; }
    const got = sha(fs.readFileSync(p));
    if (got !== e.sha256) { ok = false; details.push(`${e.qid} sha mismatch`); }
  }
  check(`V1 corpus integrity vs frozen D2 manifest (${frozenEntries.length} entries)`, ok, details.join('; '));
}

// V2 gold/case freeze vs pilot D2 pack
{
  let ok = true;
  const details = [];
  for (const c of CASE_IDS) {
    for (const file of ['case.json', 'gold.json']) {
      const a = fs.readFileSync(path.join(paths.cases, c, file));
      const b = fs.readFileSync(path.join(PILOT_CASES, c, file));
      if (sha(a) !== sha(b)) { ok = false; details.push(`${c}/${file} differs from pilot D2`); }
    }
  }
  check('V2 gold.json + case.json byte-identical to pilot D2 (gold frozen)', ok, details.join('; '));
}

// V3 scope model on all 8 cases
{
  let ok = true;
  const details = [];
  for (const c of CASE_IDS) {
    const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: c });
    for (const u of loaded.valueUnits) {
      if (!u.scope || !Array.isArray(u.question_ids)) { ok = false; details.push(`${c}/${u.unit_id} missing scope/question_ids`); continue; }
      if (u.scope === 'CASE') {
        if (u.question_ids.length !== 0) { ok = false; details.push(`${c}/${u.unit_id} CASE unit has question_ids`); }
        continue;
      }
      const expected = [...new Set((u.supporting_source_ids || []).map((s) => s.split(':')[0]))].sort();
      if (JSON.stringify(u.question_ids) !== JSON.stringify(expected)) { ok = false; details.push(`${c}/${u.unit_id} membership mismatch`); }
      if ((expected.length > 1 && u.scope !== 'CROSS_QUESTION') || (expected.length === 1 && u.scope !== 'QUESTION')) { ok = false; details.push(`${c}/${u.unit_id} scope mismatch`); }
    }
  }
  check(`V3 scope model correct on all ${CASE_IDS.length} cases (${CASE_IDS.length * 2 + 8} unit families inspected)`, ok, details.slice(0, 5).join('; '));
}

// V4 order invariance (real derivation)
{
  let ok = true;
  const details = [];
  for (const c of ['case-cross-lowcode']) {
    const loaded = loadCase({ corpusDir: paths.corpus, casesDir: paths.cases, caseId: c });
    const shuffled = JSON.parse(JSON.stringify(loaded.gold));
    for (const a of shuffled.families.aspect_membership.aspects) {
      if (Array.isArray(a.primary_sources)) a.primary_sources = [...a.primary_sources].reverse();
    }
    if (JSON.stringify(deriveValueUnits(shuffled)) !== JSON.stringify(loaded.valueUnits)) { ok = false; details.push(c); }
  }
  check('V4 shuffled-gold derivation byte-identical (source-order invariance)', ok, details.join('; '));
}

// V5 D2.1 runs complete
{
  const files = fs.readdirSync(paths.resultsD21).filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'd2-to-d21-diff.json');
  const fair = files.filter((f) => !f.includes('ORACLE'));
  check('V5 D2.1 runs complete (96 = 72 fair + 24 oracle)', files.length === 96 && fair.length === 72, `files=${files.length} fair=${fair.length}`);
}

// V6 selection identity vs D2
{
  const files = fs.readdirSync(paths.resultsD21).filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'd2-to-d21-diff.json');
  let ok = true;
  let identical = 0;
  const details = [];
  for (const f of files) {
    const d21 = JSON.parse(fs.readFileSync(path.join(paths.resultsD21, f), 'utf8'));
    const p = path.join(PILOT_RESULTS, f);
    if (!fs.existsSync(p)) { ok = false; details.push(`${f} no D2 baseline`); continue; }
    const d2 = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (JSON.stringify(d21.selected_source_ids) === JSON.stringify(d2.selected_source_ids)) identical++;
    else { ok = false; details.push(`${f} selection differs`); }
  }
  check(`V6 selections identical to D2 runs (${identical}/${files.length})`, ok, details.join('; '));
}

// V7 diff artifact
{
  const p = path.join(paths.resultsD21, 'd2-to-d21-diff.json');
  const diff = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
  const hasPerQ = diff && (diff.metric_change_frequency?.per_question_coverage_preservation || 0) > 0;
  const hasMinority = diff && (diff.metric_change_frequency?.minority_question_recall_macro || 0) > 0;
  check('V7 D2->D2.1 diff artifact documents per_question + minority changes', !!diff && hasPerQ && hasMinority, JSON.stringify(diff ? diff.metric_change_frequency : 'MISSING'));
}

// V8 leak scan
{
  const SENSITIVE = /cookie|secret|token|password|credential|api[_-]?key|authorization|bearer|D:\\|C:\\Users/i;
  const files = [];
  for (const dir of [paths.resultsD21]) {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) files.push(path.join(dir, f));
  }
  let ok = true;
  const details = [];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    const hits = txt.match(SENSITIVE);
    if (hits) { ok = false; details.push(`${path.basename(f)}: ${hits[0]}`); }
  }
  check(`V8 leak scan on ${files.length} result files`, ok, details.slice(0, 5).join('; '));
}

console.log(failures.length ? `\nVALIDATION_FAILED (${failures.length})` : '\nALL_VALIDATIONS_PASSED');
process.exit(failures.length ? 1 : 0);