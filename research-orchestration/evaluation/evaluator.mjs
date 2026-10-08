// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from '../lib/state.mjs';
import { canonicalJson } from '../lib/cross-group-aggregation.mjs';
import { validateCompleteReuseClosure } from '../lib/p1-reuse-closure.mjs';
import { deriveCanonicalSourceId } from '../lib/rce-input-adapter.mjs';
import { json } from '../scripts/p2a-t14/fixtures.mjs';

export const EVALUATOR_VERSION = 'p2-f01-exact-supported-statements-v1';

export function inventory(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error('EVALUATION_SYMLINK_REFUSED');
      return entry.isDirectory() ? inventory(path.join(dir, entry.name), rel)
        : [{ path: rel, sha256: sha256File(path.join(dir, entry.name)) }];
    });
}

/** Reads completed artifacts only. The existing closure authority grants integrity. */
export function observeProduct(workDir, config) {
  const before = inventory(workDir);
  const state = json(path.join(workDir, 'orchestration-state.json'));
  const closure = validateCompleteReuseClosure({ workDir, state,
    boundPlanHash: state?.p1FinalCoveragePlanHash, currentConfigFingerprint: config });
  if (!closure.valid) throw new Error('EVALUATION_PRODUCT_CLOSURE_INVALID');
  const final = json(path.join(workDir, 'coverage-final.json'));
  const groups = json(path.join(workDir, 'multi-group-state.json')).groups;
  const sources = Object.values(groups).flatMap(group => {
    if (group.verified !== true || group.handoffValid !== true) return [];
    const file = path.join(workDir, group.evidenceRef);
    if (sha256File(file) !== group.artifactHashes.answersJson) throw new Error('EVALUATION_SOURCE_HASH_MISMATCH');
    return json(file).answers.map(answer => ({ question_id: group.questionId,
      source_id: deriveCanonicalSourceId(group.groupId, answer.id), text: answer.content,
      evidence_ref: group.evidenceRef, artifact_hash: group.artifactHashes.answersJson }));
  });
  const synthesis = json(path.join(workDir, 'cross-source-synthesis.json')).synthesis;
  const rawClaims = [...synthesis.families.flatMap(family => family.sourceClaims),
    ...synthesis.unresolved.map(item => item.sourceClaim)];
  const claims = rawClaims.map(claim => ({ claim_id: claim.sourceClaimId, statement: claim.statement,
    source_refs: claim.sourceRefs.map(ref => ref.sourceRef) }));
  const coverage = final.coverage.analysisCoverage;
  if (canonicalJson(before) !== canonicalJson(inventory(workDir))) throw new Error('EVALUATOR_MUTATED_PRODUCT');
  return { valid: true, run_id: state.runId, occurrence_id: state.occurrenceId, plan_hash: state.p1FinalCoveragePlanHash,
    sources, claims, selected: coverage.selectedCorpusSourceSet, analyzed: coverage.analyzedSourceSet,
    stop_reason: final.coverage.retrieval.stopReason, targeted_gaps: final.targetedResearchGaps ?? null,
    artifact_hashes: before, product_checkpoint_hashes: state.hashes };
}

const metric = hits => ({ hits: hits.filter(item => item.hit).length, total: hits.length,
  ratio: hits.length ? hits.filter(item => item.hit).length / hits.length : 'UNKNOWN', targets: hits });

/** Conservative content match. Curators define accepted full statements, never aspect names. */
export function measureTargets(observation, targets) {
  if (observation.valid !== true) throw new Error('EVALUATION_UNVERIFIED_OBSERVATION');
  const invalid = () => { throw new Error('EVALUATION_TARGET_INVALID'); };
  for (const key of ['important_aspects', 'counterpositions', 'key_evidence']) {
    if (!Array.isArray(targets[key])) invalid();
    const ids = new Set();
    for (const target of targets[key]) {
      if (typeof target.target_id !== 'string' || !target.target_id || ids.has(target.target_id)) invalid();
      ids.add(target.target_id);
      if (key === 'key_evidence') {
        if (typeof target.question_id !== 'string' || typeof target.expected_text !== 'string' || !target.expected_text) invalid();
      } else if (!Array.isArray(target.support_any_of) || !target.support_any_of.length
          || target.support_any_of.some(item => typeof item.question_id !== 'string'
            || !Array.isArray(item.accepted_statements) || !item.accepted_statements.length
            || item.accepted_statements.some(statement => typeof statement !== 'string' || !statement))) invalid();
    }
  }
  const selected = new Set(observation.selected);
  const analyzed = new Set(observation.analyzed);
  const supported = requirement => {
    for (const source of observation.sources) {
      if (source.question_id !== requirement.question_id || !selected.has(source.source_id) || !analyzed.has(source.source_id)) continue;
      const claim = observation.claims.find(item => item.source_refs.includes(source.source_id)
        && requirement.accepted_statements.includes(item.statement) && source.text.includes(item.statement));
      if (claim) return { question_id: source.question_id, source_id: source.source_id,
        claim_id: claim.claim_id, statement: claim.statement };
    }
    return null;
  };
  const contentHits = list => metric(list.map(target => {
    const proof = target.support_any_of.map(supported).find(Boolean) ?? null;
    return { target_id: target.target_id, hit: proof !== null, proof };
  }));
  return {
    important_aspect_discovery: contentHits(targets.important_aspects),
    counterposition_discovery: contentHits(targets.counterpositions),
    key_evidence_discovery: metric(targets.key_evidence.map(target => {
      const source = observation.sources.find(source => source.question_id === target.question_id
        && source.text === target.expected_text
        && selected.has(source.source_id) && analyzed.has(source.source_id));
      return { target_id: target.target_id, hit: !!source, proof: source
        ? { question_id: source.question_id, source_id: source.source_id, artifact_hash: source.artifact_hash ?? 'UNKNOWN' } : null };
    })),
  };
}

/** No weights, aggregate quality score, or value verdict. */
export function compareResults(baseline, candidate) {
  if (baseline.status !== 'VALID' || candidate.status !== 'VALID') {
    return { status: 'INVALID', reason: 'PRODUCT_RUN_INCOMPLETE',
      product_failures: { baseline: baseline.product_failure ?? null, candidate: candidate.product_failure ?? null } };
  }
  if (canonicalJson(baseline.identity) !== canonicalJson(candidate.identity)) {
    return { status: 'INVALID', reason: 'PAIR_CONFOUND_IDENTITY_MISMATCH' };
  }
  const metricDeltas = Object.fromEntries(Object.keys(baseline.metrics).map(key => {
    const a = baseline.metrics[key]; const b = candidate.metrics[key];
    if (a.total !== b.total || canonicalJson(a.targets.map(item => item.target_id))
        !== canonicalJson(b.targets.map(item => item.target_id))) throw new Error('BENCHMARK_TARGET_DRIFT');
    return [key, { baseline_hits: a.hits, candidate_hits: b.hits, total: a.total,
      delta_hits: b.hits - a.hits, delta_ratio: a.total ? b.ratio - a.ratio : 'UNKNOWN' }];
  }));
  const deltas = Object.values(metricDeltas).map(value => value.delta_hits);
  const costDeltas = Object.fromEntries(Object.keys(baseline.cost).map(key => [key,
    typeof baseline.cost[key] === 'number' && typeof candidate.cost[key] === 'number'
      ? candidate.cost[key] - baseline.cost[key] : 'UNKNOWN']));
  return { status: 'VALID', metrics: metricDeltas, incremental_cost: costDeltas,
    quality_change: deltas.some(value => value < 0) ? 'REGRESSION'
      : deltas.some(value => value > 0) ? 'GAIN_ON_CURATED_TARGETS' : 'NO_MEASURABLE_GAIN',
    scope: 'CURATED_TARGETS != OPEN_WORLD_COMPLETENESS' };
}
