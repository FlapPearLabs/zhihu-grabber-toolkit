// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/coverage-state.test.mjs
 *
 * P1-T07 focused tests — ResearchCoverageState contract + update hooks (Issue #39, Spec §9, §6.2, §10.2).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  COVERAGE_STATE_SCHEMA_VERSION,
  COVERAGE_STATE_FILENAME,
  OWNER_T06_RETRIEVAL,
  OWNER_RETRIEVAL_CONTROLLER,
  OWNER_T09_SOURCE_COMPLETENESS,
  OWNER_T12_SELECTION,
  OWNER_T13_ANALYSIS,
  OWNER_T14_SYNTHESIS,
  OWNER_T15_FINAL,
  COVERAGE_ERROR_UNAUTHORIZED_OWNER,
  COVERAGE_ERROR_INVALID_STATE,
  COVERAGE_ERROR_MALFORMED_UPDATE,
  COVERAGE_ERROR_ILLEGAL_WRITE,
  COVERAGE_ERROR_INCOMPLETE_ANALYSIS,
  IMPLEMENTATION_DEFAULTS_RECORD,
  createInitialCoverageState,
  validateCoverageState,
  canonicalizeCoverageState,
  updateRetrievalCoverage,
  updateSourceCompleteness,
  updateSelectionAccounting,
  updatePerGroupAnalysis,
  updateSynthesisDiagnostics,
  reconcileFinalCoverage,
  coverageStateHash,
  persistCoverageState,
  loadCoverageState,
} from '../lib/coverage-state.mjs';

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coverage-${prefix}-`));
}

const VALID_PLAN_HASH = 'a'.repeat(64);

test('P1-T07: createInitialCoverageState creates valid 3-ledger schema + §9.4 diagnostics', () => {
  const state = createInitialCoverageState({
    planHash: VALID_PLAN_HASH,
    plannedQueryVariants: ['query 1', 'query 2'],
  });

  assert.equal(state.schemaVersion, COVERAGE_STATE_SCHEMA_VERSION);
  assert.equal(state.planHash, VALID_PLAN_HASH);

  // 1. Retrieval Coverage (§9.1)
  assert.deepEqual(state.retrieval.plannedQueryVariants, ['query 1', 'query 2']);
  assert.deepEqual(state.retrieval.executedRoutes, []);
  assert.equal(state.retrieval.fusedCandidateCount, 0);
  assert.equal(state.retrieval.fusedGroupCount, 0);
  assert.deepEqual(state.retrieval.providerFailures, []);
  assert.equal(state.retrieval.retrievalRounds, 0);
  assert.equal(state.retrieval.stopReason, null);

  // 2. Source Completeness (§9.2)
  assert.deepEqual(state.sourceCompleteness.perGroupStatus, {});
  assert.equal(state.sourceCompleteness.diagnostics.capturedNotVerifiedCount, 0);
  assert.equal(state.sourceCompleteness.diagnostics.totalSelectedCount, 0);
  assert.equal(state.sourceCompleteness.diagnostics.totalVerifiedCount, 0);

  // 3. Analysis Coverage (§9.3)
  assert.deepEqual(state.analysisCoverage.selectedCorpusSourceSet, []);
  assert.deepEqual(state.analysisCoverage.mappedSourceSet, []);
  assert.deepEqual(state.analysisCoverage.analyzedSourceSet, []);
  assert.deepEqual(state.analysisCoverage.evidenceRefIssues.missingRefs, []);
  assert.equal(state.analysisCoverage.is100PercentAnalysis, false);

  // 4. Simple Diagnostics (§9.4)
  assert.equal(state.diagnostics.new_aspect_rate, 0);
  assert.equal(state.diagnostics.new_claim_rate, 0);
  assert.equal(state.diagnostics.new_expert_rate, 0);
  assert.equal(state.diagnostics.new_contradiction_rate, 0);
  assert.equal(state.diagnostics.novelty_gain, 0);
  assert.equal(state.diagnostics.selected_source_group_count, 0);
  assert.deepEqual(state.diagnostics.selected_content_by_group, {});
  assert.equal(state.diagnostics.largest_group_share, 0);
  assert.equal(state.diagnostics.selected_author_concentration, 0);
  assert.deepEqual(state.diagnostics.selected_content_type_distribution, {});
  assert.equal(state.diagnostics.claim_source_diversity, 0);
  assert.deepEqual(state.diagnostics.per_group_selection_coverage, {});
});

test('P1-T07: D-6 implementation defaults record is explicit and valid', () => {
  assert.equal(IMPLEMENTATION_DEFAULTS_RECORD.type, 'IMPLEMENTATION_DEFAULT');
  assert.equal(IMPLEMENTATION_DEFAULTS_RECORD.immutableSpecTruth, false);
  
  // D-6 Evidence: Validate that the default config schema is structurally sound
  // and fail-closed compatible, rather than merely asserting exact constants.
  const retrieval = IMPLEMENTATION_DEFAULTS_RECORD.retrieval;
  assert.ok(Object.isFrozen(IMPLEMENTATION_DEFAULTS_RECORD));
  assert.ok(Object.isFrozen(retrieval));
  assert.ok(typeof retrieval.defaultMaxRetrievalRounds === 'number' && retrieval.defaultMaxRetrievalRounds > 0);
  assert.ok(typeof retrieval.defaultMaxQueryBudget === 'number' && retrieval.defaultMaxQueryBudget > 0);
  assert.ok(typeof retrieval.defaultSaturationNoveltyGainThreshold === 'number' && retrieval.defaultSaturationNoveltyGainThreshold >= 0 && retrieval.defaultSaturationNoveltyGainThreshold <= 1);
  assert.ok(typeof retrieval.defaultMinRoundsBeforeSaturation === 'number' && retrieval.defaultMinRoundsBeforeSaturation > 0);
  
  const sc = IMPLEMENTATION_DEFAULTS_RECORD.sourceCompleteness;
  assert.ok(Object.isFrozen(sc));
  assert.equal(typeof sc.requireExplicitCompletenessEvidence, 'boolean');
  
  const ac = IMPLEMENTATION_DEFAULTS_RECORD.analysisCoverage;
  assert.ok(Object.isFrozen(ac));
  assert.equal(typeof ac.strictSetEqualityRequiredFor100Percent, 'boolean');
});

test('P1-T07: Serialization and hashing determinism', () => {
  const state1 = createInitialCoverageState({ planHash: VALID_PLAN_HASH, plannedQueryVariants: ['b', 'a'] });
  const state2 = createInitialCoverageState({ planHash: VALID_PLAN_HASH, plannedQueryVariants: ['a', 'b'] });

  const hash1 = coverageStateHash(state1);
  const hash2 = coverageStateHash(state2);

  assert.equal(hash1, hash2, 'Hash must be identical regardless of insertion order');
});

test('P1-T07: Persistence round-trip (save and load)', () => {
  const dir = tmpDir('persist');
  const state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  const saveRes = persistCoverageState(dir, state);
  assert.equal(saveRes.ok, true);
  assert.ok(fs.existsSync(path.join(dir, COVERAGE_STATE_FILENAME)));

  const loadRes = loadCoverageState(dir);
  assert.equal(loadRes.ok, true);
  assert.equal(loadRes.hash, saveRes.hash);
  assert.deepEqual(loadRes.state, state);
});

test('P1-T07: Hook 1 (updateRetrievalCoverage) - legal path and ownership check', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Unauthorized caller rejected
  assert.throws(
    () => updateRetrievalCoverage(state, { fusedCandidateCount: 5 }, { caller: 'UNAUTHORIZED' }),
    (err) => err.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER
  );

  // Cross-ledger illegal write rejected
  assert.throws(
    () => updateRetrievalCoverage(state, { sourceCompleteness: {} }, { caller: OWNER_T06_RETRIEVAL }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );

  // Legal update
  state = updateRetrievalCoverage(
    state,
    {
      fusedCandidateCount: 10,
      fusedGroupCount: 3,
      retrievalRounds: 1,
      novelty_gain: 0.8,
      executedRoutes: [{ query: 'q1', providerId: 'p1', capability: 'search', roundIndex: 1 }],
      providerFailures: [{ code: 'TIMEOUT', class: 'NETWORK_FAILURE' }],
    },
    { caller: OWNER_T06_RETRIEVAL }
  );

  assert.equal(state.retrieval.fusedCandidateCount, 10);
  assert.equal(state.retrieval.fusedGroupCount, 3);
  assert.equal(state.retrieval.retrievalRounds, 1);
  assert.equal(state.diagnostics.novelty_gain, 0.8);
  assert.equal(state.retrieval.executedRoutes.length, 1);
  assert.equal(state.retrieval.providerFailures.length, 1);
});

test('P1-T07: Hook 2 (updateSourceCompleteness) - legal path and ownership check (T09)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Unauthorized caller rejected
  assert.throws(
    () => updateSourceCompleteness(state, { perGroupStatus: {} }, { caller: 'T06' }),
    (err) => err.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER
  );

  // Cross-ledger illegal write rejected
  assert.throws(
    () => updateSourceCompleteness(state, { retrieval: {} }, { caller: OWNER_T09_SOURCE_COMPLETENESS }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );

  // Legal update
  state = updateSourceCompleteness(
    state,
    {
      perGroupStatus: {
        'group-1': {
          captured: true,
          verified: true,
          partial: false,
          failed: false,
          paginationStatus: 'complete',
          evidenceRef: 'evidence-hash-1',
          selectedCount: 5,
          verifiedCount: 5,
        },
      },
      diagnostics: {
        capturedNotVerifiedCount: 0,
        totalSelectedCount: 5,
        totalVerifiedCount: 5,
      },
    },
    { caller: OWNER_T09_SOURCE_COMPLETENESS }
  );

  assert.equal(state.sourceCompleteness.perGroupStatus['group-1'].verified, true);
  assert.equal(state.sourceCompleteness.diagnostics.totalVerifiedCount, 5);
});

test('P1-T07: Hook 3 (updateSelectionAccounting) - legal path and ownership check (T12)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Unauthorized caller rejected
  assert.throws(
    () => updateSelectionAccounting(state, { selectedCorpusSourceSet: ['s1'] }, { caller: 'T09' }),
    (err) => err.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER
  );

  // Cross-ledger illegal write (T12 cannot write mappedSourceSet or analyzedSourceSet)
  assert.throws(
    () => updateSelectionAccounting(state, { analyzedSourceSet: ['s1'] }, { caller: OWNER_T12_SELECTION }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );

  // Legal update
  state = updateSelectionAccounting(
    state,
    {
      selectedCorpusSourceSet: ['s2', 's1'],
      selected_source_group_count: 2,
      largest_group_share: 0.6,
      selected_author_concentration: 0.2,
    },
    { caller: OWNER_T12_SELECTION }
  );

  assert.deepEqual(state.analysisCoverage.selectedCorpusSourceSet, ['s1', 's2']);
  assert.equal(state.diagnostics.selected_source_group_count, 2);
  assert.equal(state.diagnostics.largest_group_share, 0.6);
  assert.equal(state.diagnostics.selected_author_concentration, 0.2);
});

test('P1-T07: Hook 4 (updatePerGroupAnalysis) - legal path and ownership check (T13)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Unauthorized caller rejected
  assert.throws(
    () => updatePerGroupAnalysis(state, { analyzedSourceSet: ['s1'] }, { caller: 'T12' }),
    (err) => err.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER
  );

  // Cross-ledger illegal write (T13 cannot write selectedCorpusSourceSet)
  assert.throws(
    () => updatePerGroupAnalysis(state, { selectedCorpusSourceSet: ['s1'] }, { caller: OWNER_T13_ANALYSIS }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );

  // Legal update
  state = updatePerGroupAnalysis(
    state,
    {
      mappedSourceSet: ['s1', 's2'],
      analyzedSourceSet: ['s1', 's2'],
      new_aspect_rate: 0.7,
      new_claim_rate: 0.5,
      new_expert_rate: 0.3,
      new_contradiction_rate: 0.1,
    },
    { caller: OWNER_T13_ANALYSIS }
  );

  assert.deepEqual(state.analysisCoverage.analyzedSourceSet, ['s1', 's2']);
  assert.equal(state.diagnostics.new_aspect_rate, 0.7);
  assert.equal(state.diagnostics.new_claim_rate, 0.5);
});

test('P1-T07: Hook 5 (updateSynthesisDiagnostics) - strict ownership boundaries (T14)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // Unauthorized caller rejected
  assert.throws(
    () => updateSynthesisDiagnostics(state, { claim_source_diversity: 0.8 }, { caller: 'T13' }),
    (err) => err.code === COVERAGE_ERROR_UNAUTHORIZED_OWNER
  );

  // Strict boundary: T14 CANNOT write analyzedSourceSet or mappedSourceSet or selectedCorpusSourceSet!
  assert.throws(
    () => updateSynthesisDiagnostics(state, { analyzedSourceSet: ['s1'] }, { caller: OWNER_T14_SYNTHESIS }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );
  assert.throws(
    () => updateSynthesisDiagnostics(state, { mappedSourceSet: ['s1'] }, { caller: OWNER_T14_SYNTHESIS }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );
  assert.throws(
    () => updateSynthesisDiagnostics(state, { selectedCorpusSourceSet: ['s1'] }, { caller: OWNER_T14_SYNTHESIS }),
    (err) => err.code === COVERAGE_ERROR_ILLEGAL_WRITE
  );

  // Legal update
  state = updateSynthesisDiagnostics(
    state,
    {
      claim_source_diversity: 0.85,
    },
    { caller: OWNER_T14_SYNTHESIS }
  );

  assert.equal(state.diagnostics.claim_source_diversity, 0.85);
});

test('P1-T07: Hook 6 (reconcileFinalCoverage) - 100% Analysis assertion contract (T15)', () => {
  let state = createInitialCoverageState({ planHash: VALID_PLAN_HASH });

  // 1. Initial state: empty corpus -> cannot assert 100% analysis
  assert.throws(
    () => reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true }),
    (err) => err.code === COVERAGE_ERROR_INCOMPLETE_ANALYSIS
  );

  // 2. Set selected corpus to ['s1', 's2']
  state = updateSelectionAccounting(state, { selectedCorpusSourceSet: ['s1', 's2'] }, { caller: OWNER_T12_SELECTION });

  // Analyzed is still empty -> mismatch
  const reconciled1 = reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: false });
  assert.equal(reconciled1.analysisCoverage.is100PercentAnalysis, false);

  assert.throws(
    () => reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true }),
    (err) => err.code === COVERAGE_ERROR_INCOMPLETE_ANALYSIS
  );

  // 3. Set analyzed to only ['s1'] (partial) -> mismatch
  state = updatePerGroupAnalysis(state, { analyzedSourceSet: ['s1'], mappedSourceSet: ['s1'] }, { caller: OWNER_T13_ANALYSIS });
  const reconciled2 = reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: false });
  assert.equal(reconciled2.analysisCoverage.is100PercentAnalysis, false);

  // 4. Set analyzed to ['s1', 's2'] (exact set equality) + 0 evidence ref issues
  state = updatePerGroupAnalysis(state, { analyzedSourceSet: ['s2', 's1'], mappedSourceSet: ['s1', 's2'] }, { caller: OWNER_T13_ANALYSIS });
  const reconciled3 = reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true });
  assert.equal(reconciled3.analysisCoverage.is100PercentAnalysis, true);

  // 5. Evidence ref issues break 100% analysis assertion
  state = updatePerGroupAnalysis(
    state,
    {
      evidenceRefIssues: { missingRefs: ['ref-99'] },
    },
    { caller: OWNER_T13_ANALYSIS }
  );
  assert.throws(
    () => reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true }),
    (err) => err.code === COVERAGE_ERROR_INCOMPLETE_ANALYSIS
  );
});

test('P1-T07: Fail-closed validation against malformed and unsafe states', () => {
  // Invalid planHash
  assert.throws(
    () => createInitialCoverageState({ planHash: 'invalid-hash' }),
    (err) => err.code === COVERAGE_ERROR_INVALID_STATE
  );

  // Negative counts
  const badState = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  badState.retrieval.fusedCandidateCount = -1;
  const res1 = validateCoverageState(badState);
  assert.equal(res1.ok, false);

  // Invalid ratio rate (> 1)
  const badState2 = createInitialCoverageState({ planHash: VALID_PLAN_HASH });
  badState2.diagnostics.novelty_gain = 1.5;
  const res2 = validateCoverageState(badState2);
  assert.equal(res2.ok, false);
});
test('P1-T07: Artifact safety fail-closed for unsafe strings (e.g. credentials, absolute paths)', () => {
  const badState = createInitialCoverageState({ planHash: 'a'.repeat(64), plannedQueryVariants: ['/etc/hosts'] });
  
  // Inject an unsafe string into a non-plan field
  badState.diagnostics.unsafeField = 'C:\\\\Windows\\\\System32\\\\cmd.exe';
  const res1 = validateCoverageState(badState);
  assert.equal(res1.ok, false);
  assert.equal(res1.reason, 'artifact_safety_violation');

  // Inject a credential-shaped string
  const badState2 = createInitialCoverageState({ planHash: 'a'.repeat(64) });
  badState2.retrieval.stopReason = 'failed with api_key=12345';
  const res2 = validateCoverageState(badState2);
  assert.equal(res2.ok, false);
});

test('P1-T07: Source Completeness accounting invariant enforcement', () => {
  let state = createInitialCoverageState({ planHash: 'a'.repeat(64) });
  
  // verifiedCount > selectedCount
  assert.throws(() => {
    updateSourceCompleteness(state, {
      perGroupStatus: {
        'g1': { captured: true, verified: true, partial: false, failed: false, paginationStatus: 'complete', evidenceRef: 'ref', selectedCount: 5, verifiedCount: 6 }
      },
      diagnostics: { totalSelectedCount: 5, totalVerifiedCount: 6, capturedNotVerifiedCount: 0 }
    }, { caller: OWNER_T09_SOURCE_COMPLETENESS });
  }, (err) => err.code === COVERAGE_ERROR_INVALID_STATE && err.message.includes('exceeds selectedCount'));

  // inconsistent aggregate
  assert.throws(() => {
    updateSourceCompleteness(state, {
      perGroupStatus: {
        'g1': { captured: true, verified: true, partial: false, failed: false, paginationStatus: 'complete', evidenceRef: 'ref', selectedCount: 5, verifiedCount: 5 }
      },
      diagnostics: { totalSelectedCount: 10, totalVerifiedCount: 5, capturedNotVerifiedCount: 5 }
    }, { caller: OWNER_T09_SOURCE_COMPLETENESS });
  }, (err) => err.code === COVERAGE_ERROR_INVALID_STATE && err.message.includes('aggregate counts'));
});

test('P1-T07: Final analysis assertion mappedSourceSet equality requirement', () => {
  let state = createInitialCoverageState({ planHash: 'a'.repeat(64) });
  state = updateSelectionAccounting(state, { selectedCorpusSourceSet: ['s1', 's2'] }, { caller: OWNER_T12_SELECTION });
  state = updatePerGroupAnalysis(state, { mappedSourceSet: ['s1'], analyzedSourceSet: ['s1', 's2'] }, { caller: OWNER_T13_ANALYSIS });
  
  assert.throws(() => reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true }),
    (err) => err.code === COVERAGE_ERROR_INCOMPLETE_ANALYSIS);

  state = updatePerGroupAnalysis(state, { mappedSourceSet: ['s1', 's2'], analyzedSourceSet: ['s1', 's2'] }, { caller: OWNER_T13_ANALYSIS });
  const finalState = reconcileFinalCoverage(state, { caller: OWNER_T15_FINAL, assertFullCoverage: true });
  assert.equal(finalState.analysisCoverage.is100PercentAnalysis, true);
});
