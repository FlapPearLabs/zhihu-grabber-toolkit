/**
 * research-orchestration/test/p1-seam-contracts.test.mjs
 *
 * P1 Seam Contract tests (SEAM A–C V1; SEAM D V1-historical + V2 TYPE_A).
 *
 * Authority: docs/planning/P1_SEAM_CONTRACTS_V1.md +
 *            docs/planning/P1_PARALLEL_EXECUTION_CONTRACT_V1.md
 *            (both NON_AUTHORITATIVE_CANDIDATE until external audit + merge);
 *            SEAM D V2 additionally transcribes the 2026-09-19 repair
 *            amendment (docs/specs/p1-cross-question-deep-research.md §8/§9.4,
 *            commit afb391e).
 *
 * Purpose (workflow reform, not product implementation):
 *   1. golden fixtures validate against frozen seam invariants;
 *   2. downstream consumers (T13/T14/T15) can develop against upstream
 *      fixtures WITHOUT upstream implementations existing;
 *   3. ownership rules (analyzed identity single writer = P1-T13) and
 *      forbidden canonical-content duplication are mechanically detectable;
 *   4. fail-closed semantics are exercised as reject-with-error-code.
 *
 * P1-R03 version routing (Issue #91): SEAM D V2 TYPE_A cases live under
 * fixtures/p1-seams/seam-d/v2/ and run ONLY through
 * validateSynthesisOutputV2. Historical V1 validation is an EXPLICIT route
 * (validateSynthesisOutputV1Historical) — no automatic downgrade in either
 * direction, and a passing V1 route never masquerades as V2 conformance.
 * The real producer still emits V1 (CURRENT_PRODUCER_V2_CONFORMANCE =
 * NOT_IMPLEMENTED; the atomic switch belongs to P1-R05).
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
  validateSynthesisOutputV1Historical,
  validateSynthesisOutputV2,
  recomputeSynthesisIdentityV2,
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

  // ---- T13-I3 ratified SEAM C V1 amendment (2026-09-05): authorRef carrier ----

  test('authorRef amendment: every fixture claim entry carries a REQUIRED but NULLABLE authorRef', () => {
    const artifact = multiGroup();
    let count = 0;
    for (const group of artifact.groupRepresentations) {
      for (const kind of ['main', 'minority', 'contradictory']) {
        for (const claim of group.claims[kind]) {
          count += 1;
          assert.ok(Object.prototype.hasOwnProperty.call(claim, 'authorRef'), `${claim.claimId} must carry authorRef`);
          assert.ok(
            claim.authorRef === null || /^author-[0-9a-f]{16}$/.test(claim.authorRef),
            `${claim.claimId}.authorRef must be null or author-<16hex>`,
          );
        }
      }
    }
    assert.ok(count > 0);
  });

  test('authorRef amendment: same captured author → same authorRef everywhere (deterministic lineage)', () => {
    const artifact = multiGroup();
    // Both c-23456789-002 (minority) and c-23456789-003 (contradictory) are
    // backed by the same source/author in the fixture → identical authorRef.
    const minority = artifact.groupRepresentations[0].claims.minority[0].authorRef;
    const contradictory = artifact.groupRepresentations[0].claims.contradictory[0].authorRef;
    assert.equal(minority, contradictory);
  });

  test('authorRef amendment: missing authorRef field fails closed (SEAM_C_AUTHOR_REF_REQUIRED)', () => {
    const mutated = multiGroup();
    delete mutated.groupRepresentations[0].claims.main[0].authorRef;
    const result = validateGroupRepresentations(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_C_AUTHOR_REF_REQUIRED');
  });

  test('authorRef amendment: model-owned / garbage authorRef fails closed (SEAM_C_AUTHOR_REF_INVALID)', () => {
    for (const garbage of ['author-XYZ123', '张三', 'author-8f116bfe5d0e9a4', 42]) {
      const mutated = multiGroup();
      mutated.groupRepresentations[0].claims.main[0].authorRef = garbage;
      const result = validateGroupRepresentations(mutated);
      assert.equal(result.ok, false, `garbage ${JSON.stringify(garbage)} must be rejected`);
      assertHasError(result, 'SEAM_C_AUTHOR_REF_INVALID');
    }
  });
});

/* ================================== SEAM D ================================== */

describe('SEAM D V1 HISTORICAL — legacy category synthesis (explicit historical route)', () => {
  const valid = () => load('seam-d', 'synthesis-output.minimal.json');

  test('valid V1 synthesis with guard evidence satisfies the HISTORICAL route', () => {
    const result = validateSynthesisOutputV1Historical(valid());
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  test('V1 artifact is rejected by the V2 validator (V1 is HISTORICAL_ONLY, no downgrade masquerade)', () => {
    const result = validateSynthesisOutputV2(valid());
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_VERSION_INCOMPATIBLE');
  });

  test('V2 artifact is rejected by the historical V1 route (fail-closed, no automatic upgrade)', () => {
    const result = validateSynthesisOutputV1Historical(load('seam-d', 'v2', 'case-a.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_VERSION');
  });

  test('synthesis without pre-synthesis guard evidence fails closed', () => {
    const result = validateSynthesisOutputV1Historical(load('seam-d', 'invalid.no-guard-evidence.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_GUARD_EVIDENCE_REQUIRED');
  });

  test('support_count-only aggregation is rejected (Spec §8.2)', () => {
    const mutated = valid();
    mutated.synthesis.claims[0].support_count = 3;
    const result = validateSynthesisOutputV1Historical(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_COUNT_ONLY_CLAIM');
  });

  test('unknown diagnostic key outside Spec §9.4 frozen set is rejected', () => {
    const mutated = valid();
    mutated.diagnostics.made_up_metric = 0.5;
    const result = validateSynthesisOutputV1Historical(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_UNKNOWN_DIAGNOSTIC_KEY');
  });

  test('claim category outside frozen enum is rejected', () => {
    const mutated = valid();
    mutated.synthesis.claims[0].category = 'viral';
    const result = validateSynthesisOutputV1Historical(mutated);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_UNKNOWN_CLAIM_CATEGORY');
  });
});

/* ============================ SEAM D V2 (P1-R03) ============================ */

describe('SEAM D V2 TYPE_A — proposition families + independent unresolved (P1-R03, Issue #91)', () => {
  const V2 = 'v2';

  const loadV2 = (name) => load('seam-d', V2, name);
  const deepClone = (artifact) => JSON.parse(JSON.stringify(artifact));

  // ---- Frozen contract Cases A–F (Spec §8.3 table; semantics from authority) ----

  test('Case A — 3 ASSERTS groups → SUPPORT_ONLY + MULTI_GROUP', () => {
    const artifact = loadV2('case-a.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const family = artifact.synthesis.families[0];
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    assert.equal(new Set(family.support.map((s) => s.groupId)).size, 3);
    assert.equal(family.oppose.length, 0);
  });

  test('Case B — 3 ASSERTS + 2 OPPOSES → CONFLICTING + MULTI_GROUP (both dimensions retained)', () => {
    const artifact = loadV2('case-b.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const family = artifact.synthesis.families[0];
    assert.equal(family.relationStatus, 'CONFLICTING');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    assert.equal(new Set(family.support.map((s) => s.groupId)).size, 3);
    assert.equal(new Set(family.oppose.map((s) => s.groupId)).size, 2);
    // 两维同时存在，不可二选一：conflicting 不得丢 breadth。
    assert.ok(family.support.length > 0 && family.oppose.length > 0);
  });

  test('Case C — 1 ASSERTS group → SUPPORT_ONLY + SINGLE_GROUP', () => {
    const artifact = loadV2('case-c.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const family = artifact.synthesis.families[0];
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'SINGLE_GROUP');
    assert.equal(new Set(family.support.map((s) => s.groupId)).size, 1);
  });

  test('Case D — 2 group-local minority ASSERTS → SUPPORT_ONLY + MULTI_GROUP (kind stays lineage metadata)', () => {
    const artifact = loadV2('case-d.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const family = artifact.synthesis.families[0];
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    for (const claim of family.sourceClaims) {
      assert.equal(claim.kind, 'minority', 'minority survives as group-local lineage metadata only');
    }
    // 不生成 global minority taxonomy。
    assert.ok(!('category' in family) && !('minority' in family) && !('groupSalience' in family));
  });

  test('Case E — UNRESOLVED → supportBreadth null, independent record, families empty', () => {
    const artifact = loadV2('case-e.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(artifact.synthesis.families.length, 0);
    assert.equal(artifact.synthesis.unresolved.length, 1);
    const record = artifact.synthesis.unresolved[0];
    assert.equal(record.stance, 'UNRESOLVED');
    assert.equal(record.relationStatus, 'UNRESOLVED');
    assert.equal(record.supportBreadth, null);
    assert.ok(record.sourceClaim.sourceRefs.length > 0, 'original lineage retained');
  });

  test('Case F — same source c1 ASSERTS + c2 OPPOSES → CONFLICTING + SINGLE_GROUP, both lineages retained', () => {
    const artifact = loadV2('case-f.json');
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const family = artifact.synthesis.families[0];
    assert.equal(family.relationStatus, 'CONFLICTING');
    assert.equal(family.supportBreadth, 'SINGLE_GROUP');
    assert.equal(family.sourceClaims.length, 2);
    const [c1, c2] = family.sourceClaims;
    assert.notEqual(c1.sourceClaimId, c2.sourceClaimId);
    assert.equal(c1.sourceRefs[0].sourceRef, c2.sourceRefs[0].sourceRef, 'same source on both sides');
    assert.equal(family.support[0].sourceRef, family.oppose[0].sourceRef, 'cross-side sourceRef dedupe forbidden');
  });

  // ---- Identity: canonical hash recomputation ----

  test('synthesisIdentity is recomputed over the canonical payload and matches every valid case', () => {
    for (const name of ['case-a.json', 'case-b.json', 'case-c.json', 'case-d.json', 'case-e.json', 'case-f.json']) {
      const artifact = loadV2(name);
      assert.equal(recomputeSynthesisIdentityV2(artifact), artifact.synthesis.synthesisIdentity, name);
    }
  });

  test('array emission order does not affect identity (stable canonical total order)', () => {
    const artifact = loadV2('case-b.json');
    const original = artifact.synthesis.synthesisIdentity;
    const shuffled = deepClone(artifact);
    shuffled.synthesis.families.reverse();
    const family = shuffled.synthesis.families[0];
    family.relationships.reverse();
    family.sourceClaims.reverse();
    family.support.reverse();
    family.oppose.reverse();
    // key insertion order must not matter either
    const reordered = { diagnostics: shuffled.diagnostics, synthesis: shuffled.synthesis, planHash: shuffled.planHash, preSynthesisGuard: shuffled.preSynthesisGuard, semanticContractVersion: shuffled.semanticContractVersion, seamVersion: shuffled.seamVersion, seam: shuffled.seam };
    const result = validateSynthesisOutputV2(reordered);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(recomputeSynthesisIdentityV2(reordered), original);
  });

  test('legacy view does not influence the canonical hash', () => {
    const artifact = loadV2('case-a.json');
    const original = artifact.synthesis.synthesisIdentity;
    // LEGACY_DERIVED_VIEW single-way derivation: not CONFLICTING, MULTI_GROUP → widely-shared.
    artifact.synthesis.legacyView = { category: 'widely-shared' };
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(recomputeSynthesisIdentityV2(artifact), original);
  });

  test('content change without identity recomputation is rejected (hash never healed/rewritten)', () => {
    const artifact = loadV2('case-a.json');
    artifact.synthesis.families[0].aspect = '被篡改的维度';
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_SYNTHESIS_IDENTITY_MISMATCH');
    assert.equal(artifact.synthesis.synthesisIdentity, loadV2('case-a.json').synthesis.synthesisIdentity, 'validator must not rewrite the bad hash');
  });

  // ---- Structural negatives (each authority-listed rejection class) ----

  const structuralNegative = (name, file, code, pathHint) => {
    test(`negative — ${name} is rejected (${code})`, () => {
      const result = validateSynthesisOutputV2(loadV2(file));
      assert.equal(result.ok, false);
      const match = result.errors.find((e) => e.code === code && (pathHint === undefined || `${e.path} ${e.detail}`.includes(pathHint)));
      assert.ok(match, `expected ${code} at *${pathHint ?? ''}*, got: ${JSON.stringify(result.errors)}`);
    });
  };

  structuralNegative('empty family', 'invalid.empty-family.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'families[0].sourceClaims');
  structuralNegative('foreign claim ID in relationships', 'invalid.foreign-claim-id.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'relationships');
  structuralNegative('duplicate claim ID', 'invalid.duplicate-claim-id.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'duplicate claim ID');
  structuralNegative('missing claim ID (partition hole)', 'invalid.missing-claim-id.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'missing relationship');
  structuralNegative('rewritten anchor statement', 'invalid.bad-anchor.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'anchor.statement');
  structuralNegative('illegal stance in resolved family', 'invalid.bad-stance.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'stance');
  structuralNegative('empty lineage (bad lineage)', 'invalid.bad-lineage.json', 'SEAM_D_CLAIM_STRUCTURE_REQUIRED', 'sourceRefs');
  structuralNegative('V1 artifact masquerading as V2', 'invalid.v1-masquerade.json', 'SEAM_D_VERSION_INCOMPATIBLE', 'seamVersion');
  structuralNegative('missing semanticContractVersion', 'invalid.missing-semantic-version.json', 'SEAM_D_VERSION_INCOMPATIBLE', 'semanticContractVersion');
  structuralNegative('mixed semantic versions (seamVersion 2 + semanticContractVersion 1)', 'invalid.mixed-semantic-version.json', 'SEAM_D_VERSION_INCOMPATIBLE', 'semanticContractVersion');

  test('negative — stale/tampered hash fails closed with the identity-mismatch code only', () => {
    const result = validateSynthesisOutputV2(loadV2('invalid.bad-hash.json'));
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_SYNTHESIS_IDENTITY_MISMATCH');
    assert.ok(!result.errors.some((e) => e.code === 'SEAM_D_CLAIM_STRUCTURE_REQUIRED'), 'pure hash tamper must surface as identity mismatch, not structure noise');
  });

  // ---- Orthogonal state + diagnostics derived from canonical state ----

  test('persisted supportBreadth diverging from recomputation is rejected (never guessed from category)', () => {
    const artifact = deepClone(loadV2('case-a.json'));
    artifact.synthesis.families[0].supportBreadth = 'SINGLE_GROUP';
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_CLAIM_STRUCTURE_REQUIRED');
    assert.ok(result.errors.some((e) => e.path.includes('supportBreadth')));
  });

  test('persisted relationStatus diverging from recomputation is rejected', () => {
    const artifact = deepClone(loadV2('case-a.json'));
    artifact.synthesis.families[0].relationStatus = 'CONFLICTING';
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path.includes('relationStatus') && e.code === 'SEAM_D_CLAIM_STRUCTURE_REQUIRED'));
  });

  test('cross-side sourceRef dedupe (dropping one Case-F lineage) is rejected', () => {
    const artifact = deepClone(loadV2('case-f.json'));
    artifact.synthesis.families[0].oppose = [];
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path.includes('.oppose')));
  });

  test('legacy category taxonomy inside V2 canonical families is rejected', () => {
    const artifact = deepClone(loadV2('case-a.json'));
    artifact.synthesis.families[0].category = 'conflicting';
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_CLAIM_STRUCTURE_REQUIRED');
  });

  test('unresolved record borrowing a supportBreadth is rejected', () => {
    const artifact = deepClone(loadV2('case-e.json'));
    artifact.synthesis.unresolved[0].supportBreadth = 'MULTI_GROUP';
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_CLAIM_STRUCTURE_REQUIRED');
  });

  test('families and unresolved both empty is rejected (complete partition required)', () => {
    const artifact = deepClone(loadV2('case-e.json'));
    artifact.synthesis.unresolved = [];
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_CLAIM_STRUCTURE_REQUIRED');
  });

  test('new_contradiction_rate must equal the canonical recomputation (diagnostics read canonical, not legacy)', () => {
    const artifact = deepClone(loadV2('case-b.json'));
    artifact.diagnostics.new_contradiction_rate = 0;
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_DIAGNOSTICS_INCONSISTENT');
  });

  test('V2 validator never defaults missing diagnostics keys', () => {
    const artifact = deepClone(loadV2('case-a.json'));
    delete artifact.diagnostics.claim_source_diversity;
    const result = validateSynthesisOutputV2(artifact);
    assert.equal(result.ok, false);
    assertHasError(result, 'SEAM_D_DIAGNOSTICS_INCOMPLETE');
  });

  test('version routing is symmetric: no V2 artifact passes the historical route and no V1 artifact passes V2', () => {
    const v2ThroughV1 = validateSynthesisOutputV1Historical(loadV2('case-b.json'));
    assert.equal(v2ThroughV1.ok, false);
    assertHasError(v2ThroughV1, 'SEAM_D_VERSION');
    const v1ThroughV2 = validateSynthesisOutputV2(load('seam-d', 'synthesis-output.minimal.json'));
    assert.equal(v1ThroughV2.ok, false);
    assertHasError(v1ThroughV2, 'SEAM_D_VERSION_INCOMPATIBLE');
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
