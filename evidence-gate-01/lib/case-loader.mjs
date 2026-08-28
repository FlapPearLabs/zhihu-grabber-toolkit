// Case loader + gold freeze enforcement (CORRECTED).
// dataset_version is COMPUTED from the actual corpus bytes + gold bytes +
// value_units + freshness policy, so an in-place mutation of gold/corpus after
// freeze produces a different version hash (detectable).
// value_units are DERIVED from gold (P0-2) and frozen into the version hash;
// mechanical evidence_presence / fresh window membership are deterministic
// functions of the frozen corpus + frozen policy (P0-6).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadManifest, buildPool } from './corpus.mjs';
import { goldStatsByFamily } from './gold-stats.mjs';
import { deriveValueUnits } from './value-units.mjs';

const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function computeDatasetVersion({ corpusDir, caseDir, gold, valueUnits, freshnessWindowPolicy, generation = 'd1' }) {
  const h = crypto.createHash('sha256');
  const manifest = loadManifest(corpusDir);
  for (const e of manifest.entries) {
    const raw = fs.readFileSync(path.join(corpusDir, e.qid, 'answers.json'));
    h.update(e.qid).update(raw);
  }
  h.update('|gold|').update(JSON.stringify(gold));
  h.update('|value_units|').update(JSON.stringify(valueUnits));
  h.update('|freshness|').update(JSON.stringify(freshnessWindowPolicy));
  return generation + '-' + h.digest('hex').slice(0, 16);
}

export function loadCase({ corpusDir, casesDir, caseId }) {
  const caseFile = path.join(casesDir, caseId, 'case.json');
  if (!fs.existsSync(caseFile)) throw new Error('CASE_MISSING: ' + caseFile);
  const caseCfg = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
  if (caseCfg.case_id !== caseId) throw new Error(`CASE_ID_MISMATCH file=${caseId} cfg=${caseCfg.case_id}`);

  const goldFile = path.join(casesDir, caseId, 'gold.json');
  if (!fs.existsSync(goldFile)) throw new Error('GOLD_MISSING: ' + goldFile);
  const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));

  const pool = buildPool(corpusDir, caseCfg.question_ids);

  // P0-2: derive value_units from gold; freeze as a benchmark-only artifact.
  const valueUnits = deriveValueUnits(gold);
  gold.value_units = valueUnits;
  const valueUnitsFile = path.join(casesDir, caseId, 'value-units.json');
  const existingUnits = fs.existsSync(valueUnitsFile) ? JSON.parse(fs.readFileSync(valueUnitsFile, 'utf8')) : null;
  if (existingUnits && JSON.stringify(existingUnits) !== JSON.stringify(valueUnits)) {
    throw new Error(`VALUE_UNITS_DRIFT case=${caseId}: value-units.json no longer matches derived units`);
  }
  if (!existingUnits) fs.writeFileSync(valueUnitsFile, JSON.stringify(valueUnits, null, 2));

  const generation = String(gold.gold_version || '').startsWith('g2') ? 'd2' : 'd1';
  const dataset_version = computeDatasetVersion({
    corpusDir, caseDir: path.join(casesDir, caseId), gold, valueUnits,
    freshnessWindowPolicy: caseCfg.freshness_window_policy,
    generation,
  });

  return {
    caseCfg,
    gold,
    pool,
    valueUnits,
    dataset_version,
    goldStats: goldStatsByFamily(gold),
  };
}

// Freeze snapshot — must be identical before and after all strategy runs.
export function makeFreezeSnapshot(loaded) {
  return {
    dataset_version: loaded.dataset_version,
    gold_hash: sha256hex(Buffer.from(JSON.stringify(loaded.gold))),
    value_units_hash: sha256hex(Buffer.from(JSON.stringify(loaded.valueUnits))),
    freshness_policy_hash: sha256hex(Buffer.from(JSON.stringify(loaded.caseCfg.freshness_window_policy))),
  };
}

export function assertFreezeHeld(before, after) {
  const problems = [];
  if (before.dataset_version !== after.dataset_version) problems.push(`dataset_version changed: ${before.dataset_version} -> ${after.dataset_version}`);
  if (before.gold_hash !== after.gold_hash) problems.push('gold mutated during run');
  if (before.value_units_hash !== after.value_units_hash) problems.push('value_units mutated during run');
  if (before.freshness_policy_hash !== after.freshness_policy_hash) problems.push('freshness policy mutated during run');
  if (problems.length) throw new Error('FREEZE_VIOLATION: ' + problems.join('; '));
  return true;
}
