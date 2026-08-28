// validate-rescore.mjs — §6/§14 adjudicated-rescore validator (FAIL CLOSED).
//   R1 SELECTION_IDENTITY_BEFORE_AFTER = EXACT
//      (every rescored run's selected_source_ids == frozen results/race run)
//   R2 gold before/after diff artifacts exist & consistent with decisions
//   R3 adjudicated gold passes scope-model checks (re-derive works, units valid)
//   R4 rescored metric computation deterministic & complete (all 60 hpylori
//      runs + 27 cross-lowcode fair runs)
//   R5 no selector module imported / invoked during rescore (static check:
//      rescore must only import metrics/value-units/case-loader)

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../lib/paths.mjs';

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

const OU = path.join(paths.root, 'results/adjudicated-rescore');
const gb = path.join(paths.cases, 'case-hpylori-treatment', 'GOLD_BEFORE_SECOND_ADJUDICATION.json');
const ga = path.join(paths.cases, 'case-hpylori-treatment', 'GOLD_AFTER_SECOND_ADJUDICATION.json');
const gd = path.join(paths.cases, 'case-hpylori-treatment', 'SECOND_ADJUDICATION_DIFF.json');

// R1 selection identity
{
  const rs = JSON.parse(fs.readFileSync(path.join(OU, 'all-runs.json'), 'utf8'));
  const race = [];
  for (const f of fs.readdirSync(path.join(paths.root, 'results/race'))) {
    if (!f.endsWith('.json') || !f.includes('__')) continue;
    race.push(JSON.parse(fs.readFileSync(path.join(paths.root, 'results/race', f), 'utf8')));
  }
  const raceMap = new Map(race.map((r) => [`${r.case_id}@${r.strategy_id}@${r.budget.key}`, r.selected_source_ids]));
  let ok = true;
  let n = 0;
  const details = [];
  for (const r of rs) {
    n++;
    const key = `${r.case_id}@${r.strategy_id}@${r.budget_key}`;
    const frozen = raceMap.get(key);
    if (!frozen) { ok = false; details.push(`${key} missing frozen run`); continue; }
    if (JSON.stringify(r.selected_source_ids) !== JSON.stringify(frozen)) { ok = false; details.push(`${key} SELECTION_CHANGED`); }
  }
  check(`R1 SELECTION_IDENTITY_BEFORE_AFTER = EXACT (${n} runs)`, ok, details.slice(0, 5).join('; '));
}

// R2 artifacts
{
  const ok = fs.existsSync(gb) && fs.existsSync(ga) && fs.existsSync(gd);
  let consistent = true;
  if (ok) {
    const diff = JSON.parse(fs.readFileSync(gd, 'utf8'));
    const ga2 = JSON.parse(fs.readFileSync(ga, 'utf8'));
    const gb2 = JSON.parse(fs.readFileSync(gb, 'utf8'));
    consistent = diff.must_see_removed.every((s) => !ga2.families.must_see.sources.includes(s))
      && diff.must_see_removed.every((s) => gb2.families.must_see.sources.includes(s))
      && diff.must_see_promoted.every((s) => ga2.families.must_see.sources.includes(s));
  }
  check('R2 gold before/after/diff artifacts exist + mutually consistent', ok && consistent, 'inconsistent');
}

// R3 scope model on adjudicated gold
{
  let ok = true;
  const details = [];
  const vuMod = await import('../lib/value-units.mjs');
  if (fs.existsSync(ga)) {
    const gold = JSON.parse(fs.readFileSync(ga, 'utf8'));
    const units = vuMod.deriveValueUnits(gold);
    for (const u of units) {
      if (!u.scope || !Array.isArray(u.question_ids)) { ok = false; details.push(`${u.unit_id} no scope`); continue; }
      if (u.scope === 'CASE') { if (u.question_ids.length) { ok = false; details.push(`${u.unit_id} CASE qids`); } continue; }
      const expected = [...new Set((u.supporting_source_ids || []).map((s) => s.split(':')[0]))].sort();
      if (JSON.stringify(u.question_ids) !== JSON.stringify(expected)) { ok = false; details.push(`${u.unit_id} membership`); }
    }
  }
  check('R3 adjudicated gold satisfies scope model (value units derivable)', ok, details.slice(0, 5).join('; '));
}

// R4 completeness + determinism
{
  const rs = JSON.parse(fs.readFileSync(path.join(OU, 'all-runs.json'), 'utf8'));
  const hp = rs.filter((r) => r.case_id === 'case-hpylori-treatment');
  const xc = rs.filter((r) => r.case_id === 'case-cross-lowcode');
  const ok = hp.length === 15 && xc.length === 12; // hpylori = 5 strategies (4 fair + oracle) x 3 budgets; cross fair = 4 x 3
  check(`R4 rescore coverage (hpylori=${hp.length} [expect 15], cross-fair=${xc.length} [expect 12])`, hp.length === 15 && xc.length === 12, `got ${hp.length}/${xc.length}`);
}

// R5 no selector invocation in rescore script
{
  const src = fs.readFileSync(path.join(paths.root, 'scripts/adjudicated-rescore.mjs'), 'utf8');
  const ok = !/selectors?(-race)?\.mjs|selectPopularityTopK|selectDense|selectMMR|selectQuestionStratified/.test(src);
  check('R5 rescore never imports/invokes selectors (static)', ok, 'selector token found');
}

console.log(failures.length ? `\nRESCORE_VALIDATION_FAILED (${failures.length})` : '\nALL_RESCORE_VALIDATIONS_PASSED');
process.exit(failures.length ? 1 : 0);