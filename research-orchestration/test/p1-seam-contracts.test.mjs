/**
 * research-orchestration/test/p1-seam-contracts.test.mjs
 *
 * P1 Seam Contract tests (SEAM A–D, V1).
 *
 * Authority: docs/planning/P1_SEAM_CONTRACTS_V1.md +
 *            docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md
 *            (both NON_AUTHORITATIVE_CANDIDATE until external audit + merge).
 *
 * Purpose (workflow reform, not product implementation):
 *   1. golden fixtures validate against frozen seam invariants;
 *   2. downstream consumers (T13/T14/T15) can develop against upstream
 *      fixtures WITHOUT upstream implementations existing;
 *   3. ownership rules (analyzed identity single writer = P1-T13) and
 *      forbidden canonical-content duplication are mechanically detectable;
 *   4. fail-closed semantics are exercised as reject-with-error-code.
 *
 * Pure, offline, deterministic; fixtures are static JSON under
 * test/fixtures/p1-seams/. No network, no credentials, no product modules.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateResearchCorpusManifest,
  validateSelectedResearchCorpus,
  validateGroupRepresentations,
  validateSynthesisOutput,
  assertSeamCGuardPass,
  assertIdentityChain,
  walkForForbiddenKeys,
} from './helpers/p1-seam-contracts.mjs';

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'p1-seams');

function load(...segments) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8'));
}

function assertHasError(result, code) {
  const match = result.errors.find((e) => e.code === code);
  assert.ok(match, `expected error code ${code}, got: ${JSON.stringify(result.errors)}`);
}

/* ================================== SEAM A ================================== */

describe('SEAM A T09_TO_T12 — ResearchCorpusManifest (producer-grounded R1)', () => {
  const minimal = () => load('seam-a', 'research-corpus-manifest.minimal.json');
  const multiGroup = () => load('seam-a', 'research-corpus-manifest.multi-group.json');

  test('valid minimal case satisfies the seam', () => {
    const result = validateResearchCorpusManifest(minimal());
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  test('valid realistic multi-group case (4 selected / 3 verified / 1 captured-not-verified) satisfies the seam', () => {
    const artifact = multiGroup();
    assert.equal(artifact.groups.length, 3);
    assert.equal(artifact.accounting.capturedNotVerifiedGroupCount, 1);
    assert.equal(artifact.accounting.selectedGroupCount, 4);
    const result = validateResearchCorpusManifest(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('self-verifying manifestHash: stale/tampered manifest fails closed', () => {
    // invalid fixture = captured-not-verified group smuggled into groups[] without
    // recomputing manifestHash — exactly what the real producer hash domain detects.
    const result = validateResearchCorpusManifest(load('seam-a', 'invalid.stale-manifest-hash.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_A_MANIFEST_HASH_MISMATCH');
  });

  test('any post-hoc group mutation breaks the recomputed manifestHash (fail closed)', () => {
    const mutated = minimal();
    mutated.groups[0].capturedAnswerCount = 99;
    const result = validateResearchCorpusManifest(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_A_MANIFEST_HASH_MISMATCH');
  });

  test('canonical-content duplication is mechanically detectable (D09)', () => {
    const mutated = minimal();
    mutated.answersContent = '回答正文本体——绝不允许进入 manifest';
    const result = validateResearchCorpusManifest(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_A_CANONICAL_CONTENT_FORBIDDEN');
  });

  test('accounting inconsistency (verifiedGroupCount drift from groups[]) is detected', () => {
    const mutated = minimal();
    mutated.accounting.verifiedGroupCount = 5;
    const result = validateResearchCorpusManifest(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_A_ACCOUNTING_INCONSISTENT');
  });

  test('empty manifest (zero verified groups) is not a consumable artifact (Spec §7.2)', () => {
    const mutated = minimal();
    mutated.groups = [];
    const result = validateResearchCorpusManifest(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_A_REFS_REQUIRED');
  });
});

/* ================================== SEAM B ================================== */

describe('SEAM B T12_TO_T13 — Selected Verified Research Corpus', () => {
  const minimal = () => load('seam-b', 'selected-research-corpus.minimal.json');
  const multiGroup = () => load('seam-b', 'selected-research-corpus.multi-group.json');

  test('valid minimal case satisfies the seam', () => {
    const result = validateSelectedResearchCorpus(minimal());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('valid realistic multi-group case with full exclusion accounting satisfies the seam', () => {
    const artifact = multiGroup();
    const small = artifact.corpus.groups.find((g) => g.groupId === '45678123');
    assert.ok(small && small.selectedSourceRefs.length === 1, 'small/minority group must keep representation');
    const result = validateSelectedResearchCorpus(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('excluded eligible sources without recorded reason fail closed', () => {
    const result = validateSelectedResearchCorpus(load('seam-b', 'invalid.missing-exclusion-reason.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_B_MISSING_EXCLUSION_REASON');
  });

  test('analyzed accounting in T12 output is rejected (single writer = P1-T13)', () => {
    const mutated = minimal();
    mutated.corpus.groups[0].accounting.analyzed = 2;
    const result = validateSelectedResearchCorpus(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_B_ANALYZED_FIELD_FORBIDDEN');
  });

  test('accounting order violation (selected > verified) fails closed', () => {
    const mutated = minimal();
    mutated.corpus.groups[0].accounting.selected = 4;
    const result = validateSelectedResearchCorpus(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_B_ACCOUNTING_INCONSISTENT');
  });
});

/* ================================== SEAM C ================================== */

describe('SEAM C T13_TO_T14 — representations + aggregate analyzed identity', () => {
  const multiGroup = () => load('seam-c', 'group-representations.multi-group.json');
  const corpusB = () => load('seam-b', 'selected-research-corpus.multi-group.json');

  test('valid multi-group representations satisfy the seam (Spec §8.1 fields)', () => {
    const artifact = multiGroup();
    for (const group of artifact.groupRepresentations) {
      assert.ok(group.canonicalGroupIdentity);
      assert.ok(group.accounting);
      assert.ok(group.claims);
      assert.ok(Array.isArray(group.expertEvidenceRichRefs));
      assert.ok(group.completenessStatus);
      assert.ok(group.discussionVolume);
    }
    const result = validateGroupRepresentations(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('T13 claim sourceRefs bind to frozen T12 fixture (develop-before-upstream)', () => {
    const corpus = corpusB();
    const artifact = multiGroup();
    const known = new Set(
      corpus.corpus.groups.flatMap((g) => g.selectedSourceRefs.map((r) => r.canonicalSourceId)),
    );
    for (const group of artifact.groupRepresentations) {
      for (const kind of ['main', 'minority', 'contradictory']) {
        for (const claim of group.claims[kind]) {
          for (const ref of claim.sourceRefs) {
            assert.ok(known.has(ref), `claim ref ${ref} must exist in frozen SEAM B fixture`);
          }
        }
      }
    }
  });

  test('missing aggregate analyzed identity fails closed (single writer = P1-T13, static authority)', () => {
    // R1-F5: ownership is enforced by static authority (Issue #45 / Ticket Graph §B /
    // D10), not by a runtime owner label — the label was removed from the contract.
    const mutated = multiGroup();
    delete mutated.aggregateAnalyzedIdentity;
    const result = validateGroupRepresentations(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_C_IDENTITY_ARTIFACT_INCOMPLETE');
  });

  test('guard mismatch (analyzed set != selected set) fails closed before synthesis', () => {
    const artifact = load('seam-c', 'invalid.guard-mismatch.json');
    const structural = validateGroupRepresentations(artifact);
    assert.equal(structural.ok, true, 'structure itself is well-formed');
    const guard = assertSeamCGuardPass(
      artifact.selectedCorpusIdentityRef,
      artifact.aggregateAnalyzedIdentity.mappedAnalyzedSourceSetIdentity,
    );
    assert.equal(guard.ok, false);
    assertHasError(guard, 'SEAM_C_GUARD_MISMATCH');
  });

  test('guard equality branch admits synthesis for valid fixtures', () => {
    const artifact = multiGroup();
    const guard = assertSeamCGuardPass(
      artifact.selectedCorpusIdentityRef,
      artifact.aggregateAnalyzedIdentity.mappedAnalyzedSourceSetIdentity,
    );
    assert.equal(guard.ok, true);
  });
});

/* ================================== SEAM D ================================== */

describe('SEAM D T14_TO_T15 — synthesis artifact + diagnostics', () => {
  const valid = () => load('seam-d', 'synthesis-output.minimal.json');

  test('valid synthesis with guard evidence satisfies the seam', () => {
    const result = validateSynthesisOutput(valid());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('synthesis without pre-synthesis guard evidence fails closed', () => {
    const result = validateSynthesisOutput(load('seam-d', 'invalid.no-guard-evidence.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_GUARD_EVIDENCE_REQUIRED');
  });

  test('support_count-only aggregation is rejected (Spec §8.2)', () => {
    const mutated = valid();
    mutated.synthesis.claims[0].support_count = 3;
    const result = validateSynthesisOutput(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_COUNT_ONLY_CLAIM');
  });

  test('unknown diagnostic key outside Spec §9.4 frozen set is rejected', () => {
    const mutated = valid();
    mutated.diagnostics.made_up_metric = 0.5;
    const result = validateSynthesisOutput(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_UNKNOWN_DIAGNOSTIC_KEY');
  });

  test('claim category outside frozen enum is rejected', () => {
    const mutated = valid();
    mutated.synthesis.claims[0].category = 'viral';
    const result = validateSynthesisOutput(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_UNKNOWN_CLAIM_CATEGORY');
  });
});

/* ========================= producer-consumer chain ========================== */

describe('producer-consumer chain (B → C → D) on frozen fixtures only', () => {
  test('identity chain holds across valid B/C/D fixtures', () => {
    const b = load('seam-b', 'selected-research-corpus.multi-group.json');
    const c = load('seam-c', 'group-representations.multi-group.json');
    const d = load('seam-d', 'synthesis-output.minimal.json');
    const result = assertIdentityChain(b, c, d);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('unequal analyzed set breaks the chain — integration remains blocked (fail-closed)', () => {
    const b = load('seam-b', 'selected-research-corpus.multi-group.json');
    const c = load('seam-c', 'invalid.guard-mismatch.json');
    const d = load('seam-d', 'synthesis-output.minimal.json');
    const result = assertIdentityChain(b, c, d);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_IDENTITY_CHAIN_BREAK');
  });

  test('fixtures are static JSON: no product producer/consumer modules required', () => {
    const seamFiles = fs.readdirSync(FIXTURE_ROOT, { recursive: true }).filter((f) => String(f).endsWith('.json'));
    assert.ok(seamFiles.length >= 9, `expected >= 9 fixture files, found ${seamFiles.length}`);
  });
});

/* ============================== security meta =============================== */

describe('fixture hygiene (RULES §1 / §11)', () => {
  test('no credential-bearing keys anywhere in seam fixtures', () => {
    const forbidden = ['cookie', 'secret', 'token', 'credential', 'password'];
    const seamFiles = fs.readdirSync(FIXTURE_ROOT, { recursive: true }).filter((f) => String(f).endsWith('.json'));
    for (const file of seamFiles) {
      const artifact = JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, String(file)), 'utf8'));
      const hits = walkForForbiddenKeys(artifact, forbidden);
      assert.deepEqual(hits, [], `${file} must not contain credential-like keys`);
    }
  });
});
