// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/test/p1-r05-v2-cutover.test.mjs
 *
 * P1-R05 / Issue #93 — 原子切换命题关系生产链与证据闭包。
 *
 * This suite is the TYPE_B CURRENT-PRODUCER conformance gate: every assertion
 * runs the REAL `produceCrossSourceSynthesis` (and, where noted, the REAL
 * DeepSeek adapter over a fake transport). It never validates fixtures only —
 * the R03 V2 validator (`validateSynthesisOutputV2` /
 * `recomputeSynthesisIdentityV2`) is the contract boundary, and the real
 * producer must satisfy it.
 *
 * Authority:
 *   - docs/specs/p1-cross-question-deep-research.md §8.1–8.4 / §9.4 / §10.2 / §11
 *   - docs/planning/P1_SEAM_CONTRACTS_V1.md §SEAM D V2 (OUTPUT_OBSERVABLE_SHAPE,
 *     IDENTITY_FIELDS, REQUIRED_INVARIANTS 1–9, FAIL_CLOSED, VERSIONING_RULE)
 *   - docs/planning/P1_REPAIR_TICKET_DECOMPOSITION_V1.md §5 (Cases A–F matrix)
 *   - R03 (#91) executable contract: validateSynthesisOutputV2 is the ONLY V2
 *     acceptance boundary; V1 is explicitly historical-only.
 *
 * RED contract (pre-repair): on the V1 production path these correct V2
 * expectations FAILED because the producer emitted `synthesis.claims[]` with a
 * legacy four-way `category`, no `families`/`unresolved`, no `semanticContractVersion`,
 * support/oppose entries with NO sourceClaimId (same-source dedupe loss), and a
 * `new_contradiction_rate` derived from the legacy category.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSynthesisOutputV2,
  recomputeSynthesisIdentityV2,
  validateSynthesisOutputV1Historical,
} from './helpers/p1-seam-contracts.mjs';

import {
  produceCrossSourceSynthesis,
  deriveLegacyView,
  T14_SYNTHESIS_RUNTIME_ID,
  T14_SYNTHESIS_MODEL,
} from '../lib/cross-source-synthesis.mjs';

import { buildDeepSeekResearchRuntime } from '../lib/deepseek-research-runtime.mjs';

const PLAN_HASH = '5f1a2b3c4d5e6f708192a3b4c5d6e7f80112233445566778899aabbccddeeff0';
const IDENTITY = 'sha256:6666666666666666666666666666666666666666666666666666666666666666';

/* --------------------------- SEAM C construction --------------------------- */

/**
 * Build a structurally-valid SEAM C artifact from a compact spec.
 *
 * groups: [{ groupId, answerCount?, expertRefs?, claims: [{ claimId, kind,
 *            statement, sourceRefs: [str], authorRef }] }]
 */
function seamC(groups, { planHash = PLAN_HASH, identity = IDENTITY } = {}) {
  const byKind = (list, kind) => list
    .filter((c) => c.kind === kind)
    .map((c) => ({
      claimId: c.claimId,
      statement: c.statement,
      sourceRefs: [...c.sourceRefs],
      authorRef: c.authorRef ?? null,
    }));
  return {
    seam: 'T13_TO_T14',
    seamVersion: 1,
    planHash,
    selectedCorpusIdentityRef: identity,
    groupRepresentations: groups.map((g) => {
      const sourceCount = new Set((g.claims ?? []).flatMap((c) => c.sourceRefs)).size || 1;
      return {
        groupId: g.groupId,
        canonicalGroupIdentity: {
          questionId: g.groupId, provide: undefined,
          providerId: 'official-search',
          capability: 'searchQuestions',
        },
        accounting: { selected: sourceCount, verified: sourceCount, mapped: sourceCount, analyzed: sourceCount },
        claims: {
          main: byKind(g.claims ?? [], 'main'),
          minority: byKind(g.claims ?? [], 'minority'),
          contradictory: byKind(g.claims ?? [], 'contradictory'),
        },
        expertEvidenceRichRefs: g.expertRefs ?? [],
        completenessStatus: 'verified',
        discussionVolume: { answerCount: g.answerCount ?? 1 },
      };
    }),
    aggregateAnalyzedIdentity: {
      mappedAnalyzedSourceSetIdentity: identity,
      perGroup: Object.fromEntries(groups.map((g) => [g.groupId, IDENTITY])),
    },
  };
}

/* ----------------------------- runtime doubles ----------------------------- */

/** Injected V2 runtime double: replays an explicit proposition proposal. */
function v2Runtime(proposal) {
  const calls = [];
  return {
    runtimeId: T14_SYNTHESIS_RUNTIME_ID,
    model: T14_SYNTHESIS_MODEL,
    __calls: calls,
    async synthesize(input) {
      calls.push(JSON.parse(JSON.stringify(input)));
      return typeof proposal === 'function' ? proposal(input) : proposal;
    },
  };
}

const fam = (aspect, anchorClaimId, members) => ({ aspect, anchorClaimId, members });
const A = (claimId) => ({ claimId, stance: 'ASSERTS' });
const O = (claimId) => ({ claimId, stance: 'OPPOSES' });

/* ============================== Cases A–F ================================== */

/** Case A: three ASSERTS groups → SUPPORT_ONLY + MULTI_GROUP. */
function caseA() {
  const artifact = seamC([
    { groupId: 'g1', claims: [{ claimId: 'c-g1-1', kind: 'main', statement: '该做法有效', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' }] },
    { groupId: 'g2', claims: [{ claimId: 'c-g2-1', kind: 'main', statement: '该做法有效（第二组复述）', sourceRefs: ['g2-a-1'], authorRef: 'author-2222222222222222' }] },
    { groupId: 'g3', claims: [{ claimId: 'c-g3-1', kind: 'main', statement: '该做法有效（第三组复述）', sourceRefs: ['g3-a-1'], authorRef: 'author-3333333333333333' }] },
  ]);
  const proposal = {
    families: [fam('总体有效性', 'c-g1-1', [A('c-g1-1'), A('c-g2-1'), A('c-g3-1')])],
    unresolvedClaimIds: [],
  };
  return { artifact, proposal };
}

/** Case B: 3 ASSERTS + 2 OPPOSES → CONFLICTING + MULTI_GROUP (breadth kept). */
function caseB() {
  const artifact = seamC([
    { groupId: 'g1', claims: [{ claimId: 'c-g1-1', kind: 'main', statement: '该做法有效', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' }] },
    { groupId: 'g2', claims: [{ claimId: 'c-g2-1', kind: 'main', statement: '该做法有效（第二组）', sourceRefs: ['g2-a-1'], authorRef: 'author-2222222222222222' }] },
    { groupId: 'g3', claims: [{ claimId: 'c-g3-1', kind: 'main', statement: '该做法有效（第三组）', sourceRefs: ['g3-a-1'], authorRef: 'author-3333333333333333' }] },
    { groupId: 'g4', claims: [{ claimId: 'c-g4-1', kind: 'main', statement: '该做法无效', sourceRefs: ['g4-a-1'], authorRef: 'author-4444444444444444' }] },
    { groupId: 'g5', claims: [{ claimId: 'c-g5-1', kind: 'main', statement: '该做法会恶化结果', sourceRefs: ['g5-a-1'], authorRef: 'author-5555555555555555' }] },
  ]);
  const proposal = {
    families: [fam('总体有效性', 'c-g1-1', [
      A('c-g1-1'), A('c-g2-1'), A('c-g3-1'), O('c-g4-1'), O('c-g5-1'),
    ])],
    unresolvedClaimIds: [],
  };
  return { artifact, proposal };
}

/** Case C: single ASSERTS group → SUPPORT_ONLY + SINGLE_GROUP. */
function caseC() {
  const artifact = seamC([
    { groupId: 'g1', claims: [{ claimId: 'c-g1-1', kind: 'main', statement: '仅本组提出的观点', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' }] },
  ]);
  const proposal = { families: [fam('单组观点', 'c-g1-1', [A('c-g1-1')])], unresolvedClaimIds: [] };
  return { artifact, proposal };
}

/** Case D: two group-local MINORITY claims assert the same proposition. */
function caseD() {
  const artifact = seamC([
    { groupId: 'g1', claims: [{ claimId: 'c-g1-2', kind: 'minority', statement: '少数情况下该做法更优', sourceRefs: ['g1-a-2'], authorRef: 'author-1111111111111111' }] },
    { groupId: 'g2', claims: [{ claimId: 'c-g2-2', kind: 'minority', statement: '少数情况下该做法更优（第二组）', sourceRefs: ['g2-a-2'], authorRef: 'author-2222222222222222' }] },
  ]);
  const proposal = { families: [fam('少数条件下的效果', 'c-g1-2', [A('c-g1-2'), A('c-g2-2')])], unresolvedClaimIds: [] };
  return { artifact, proposal };
}

/** Case E: one independent UNRESOLVED record → null breadth, no fake category. */
function caseE() {
  const artifact = seamC([
    { groupId: 'g1', claims: [{ claimId: 'c-g1-9', kind: 'main', statement: '无法判断关系的表述', sourceRefs: ['g1-a-9'], authorRef: 'author-1111111111111111' }] },
  ]);
  const proposal = { families: [], unresolvedClaimIds: ['c-g1-9'] };
  return { artifact, proposal };
}

/** Case F: same source, c1 ASSERTS / c2 OPPOSES → both lineages survive. */
function caseF() {
  const artifact = seamC([
    {
      groupId: 'g1',
      claims: [
        { claimId: 'c-g1-1', kind: 'main', statement: '该配置能提升吞吐', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' },
        { claimId: 'c-g1-2', kind: 'main', statement: '该配置会降低吞吐', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' },
      ],
    },
  ]);
  const proposal = { families: [fam('同一来源的相反断言', 'c-g1-1', [A('c-g1-1'), O('c-g1-2')])], unresolvedClaimIds: [] };
  return { artifact, proposal };
}

/** Different-scope class: P50 vs P99 must NOT become a contradiction. */
function caseScope() {
  const artifact = seamC([
    {
      groupId: 'g1',
      claims: [
        { claimId: 'c-g1-p50', kind: 'main', statement: '热缓存下 P50 延迟为 5ms', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' },
        { claimId: 'c-g1-p99', kind: 'main', statement: '冷缓存下 P99 延迟为 900ms', sourceRefs: ['g1-a-2'], authorRef: 'author-1111111111111111' },
      ],
    },
  ]);
  const proposal = {
    families: [
      fam('热缓存 P50 延迟', 'c-g1-p50', [A('c-g1-p50')]),
      fam('冷缓存 P99 延迟', 'c-g1-p99', [A('c-g1-p99')]),
    ],
    unresolvedClaimIds: [],
  };
  return { artifact, proposal };
}

async function produce({ artifact, proposal }) {
  return produceCrossSourceSynthesis({ seamCArtifact: artifact, runtime: v2Runtime(proposal) });
}

/* =============================== test body ================================= */

describe('P1-R05 Cases A–F — real producer TYPE_B V2 conformance (Issue #93)', () => {
  test('Case A: 3 ASSERTS groups → SUPPORT_ONLY + MULTI_GROUP (real producer, V2 validator accepts)', async () => {
    const result = await produce(caseA());
    assert.equal(result.ok, true, JSON.stringify(result));
    const verdict = validateSynthesisOutputV2(result.artifact);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    assert.equal(result.artifact.synthesis.unresolved.length, 0);
    // anti-evasion: not all-singleton and not family-splitting
    assert.equal(result.artifact.synthesis.families.length, 1, 'the three same-proposition claims must form ONE family');
    assert.equal(family.sourceClaims.length, 3);
  });

  test('Case B: 3 ASSERTS + 2 OPPOSES → CONFLICTING + MULTI_GROUP (breadth is never collapsed by conflict)', async () => {
    const result = await produce(caseB());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'CONFLICTING');
    assert.equal(family.supportBreadth, 'MULTI_GROUP', 'Case B must keep MULTI_GROUP despite the conflict');
    assert.equal(family.support.length, 3);
    assert.equal(family.oppose.length, 2);
    // every lineage entry binds its original sourceClaimId
    assert.deepEqual([...new Set(family.support.map((s) => s.sourceClaimId))].sort(), ['c-g1-1', 'c-g2-1', 'c-g3-1']);
    assert.deepEqual([...new Set(family.oppose.map((s) => s.sourceClaimId))].sort(), ['c-g4-1', 'c-g5-1']);
  });

  test('Case C: 1 ASSERTS group → SUPPORT_ONLY + SINGLE_GROUP', async () => {
    const result = await produce(caseC());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'SINGLE_GROUP');
  });

  test('Case D: two group-local minority claims asserting the same proposition → SUPPORT_ONLY + MULTI_GROUP, no global minority', async () => {
    const result = await produce(caseD());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'SUPPORT_ONLY');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    // kind survives as group-local lineage metadata only
    assert.deepEqual(family.sourceClaims.map((c) => c.kind), ['minority', 'minority']);
    // no global minority taxonomy anywhere on the family
    for (const banned of ['category', 'minority', 'groupSalience']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(family, banned), `${banned} must not appear on a V2 family`);
    }
  });

  test('Case E: independent UNRESOLVED → relationStatus UNRESOLVED + supportBreadth null, no fake category', async () => {
    const result = await produce(caseE());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    assert.equal(result.artifact.synthesis.families.length, 0);
    assert.equal(result.artifact.synthesis.unresolved.length, 1);
    const record = result.artifact.synthesis.unresolved[0];
    assert.equal(record.stance, 'UNRESOLVED');
    assert.equal(record.relationStatus, 'UNRESOLVED');
    assert.equal(record.supportBreadth, null);
    for (const banned of ['familyKey', 'anchor', 'relationships', 'support', 'oppose', 'category']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(record, banned), `${banned} forbidden on an unresolved record`);
    }
    assert.equal(record.sourceClaim.sourceClaimId, 'c-g1-9');
  });

  test('Case F: same source c1 ASSERTS / c2 OPPOSES → CONFLICTING + SINGLE_GROUP, BOTH lineages survive (no sourceRef dedupe)', async () => {
    const result = await produce(caseF());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'CONFLICTING');
    assert.equal(family.supportBreadth, 'SINGLE_GROUP');
    // both sourceClaimIds and both lineages survive despite the identical sourceRef
    assert.deepEqual(family.support.map((s) => s.sourceClaimId), ['c-g1-1']);
    assert.deepEqual(family.oppose.map((s) => s.sourceClaimId), ['c-g1-2']);
    assert.equal(family.support[0].sourceRef, family.oppose[0].sourceRef, 'same sourceRef — dedupe would have destroyed one side');
    assert.equal(family.sourceClaims.length, 2);
  });

  test('different-scope non-conflict (P50 vs P99): no false conflict is manufactured', async () => {
    const result = await produce(caseScope());
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
    const families = result.artifact.synthesis.families;
    assert.equal(families.length, 2);
    for (const f of families) {
      assert.equal(f.relationStatus, 'SUPPORT_ONLY', `${f.aspect} must not be marked conflicting by surface wording`);
    }
    assert.equal(result.artifact.diagnostics.new_contradiction_rate, 0);
  });

  test('anti-evasion: the Cases A–F goldens are NOT all-singleton, NOT all-unresolved, NOT family-split', async () => {
    for (const [name, build] of [['A', caseA], ['B', caseB], ['C', caseC], ['D', caseD], ['E', caseE], ['F', caseF]]) {
      const result = await produce(build());
      assert.equal(result.ok, true, `case ${name}: ${JSON.stringify(result)}`);
      const { families, unresolved } = result.artifact.synthesis;
      assert.ok(families.length + unresolved.length > 0, `case ${name}: empty output`);
      // all-singleton escape: every resolved family carries exactly one claim
      const allSingleton = families.length > 1 && families.every((f) => f.sourceClaims.length === 1);
      assert.equal(allSingleton, false, `case ${name}: all-singleton escape must not be the accepted shape`);
      // all-unresolved escape: nothing resolved at all
      const allUnresolved = unresolved.length > 0 && families.length === 0;
      if (name !== 'E') {
        assert.equal(allUnresolved, false, `case ${name}: all-unresolved escape must not be the accepted shape`);
      }
      // family-splitting escape: two families over the SAME claim set
      const keys = families.map((f) => [...f.sourceClaims.map((c) => c.sourceClaimId)].sort().join('|'));
      assert.equal(new Set(keys).size, keys.length, `case ${name}: duplicate family membership (splitting)`);
    }
  });
});

describe('P1-R05 F06 evidence closure — fail-closed through the REAL producer (Issue #93)', () => {
  const base = () => caseA();

  test('empty family in a non-empty whole → fail closed T14_RUNTIME_OUTPUT_INVALID', async () => {
    const { artifact } = base();
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: artifact,
      runtime: v2Runtime({
        families: [
          fam('总体有效性', 'c-g1-1', [A('c-g1-1'), A('c-g2-1'), A('c-g3-1')]),
          { aspect: '空簇', anchorClaimId: 'c-g1-1', members: [] },
        ],
        unresolvedClaimIds: [],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_OUTPUT_INVALID');
    assert.equal(result.artifact, undefined);
  });

  test('foreign / duplicate / missing claim IDs → fail closed, no artifact', async () => {
    const foreign = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({ families: [fam('x', 'c-g1-1', [A('c-g1-1'), A('FORGED')])], unresolvedClaimIds: [] }),
    });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.code, 'T14_RUNTIME_OUTPUT_INVALID');

    const duplicate = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({
        families: [fam('a', 'c-g1-1', [A('c-g1-1'), A('c-g2-1')]), fam('b', 'c-g3-1', [A('c-g3-1'), A('c-g1-1')])],
        unresolvedClaimIds: [],
      }),
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'T14_RUNTIME_OUTPUT_INVALID');

    const missing = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({ families: [fam('a', 'c-g1-1', [A('c-g1-1')])], unresolvedClaimIds: [] }),
    });
    assert.equal(missing.ok, false, 'incomplete partition must fail closed');
    assert.equal(missing.code, 'T14_RUNTIME_OUTPUT_INVALID');
  });

  test('family/unresolved overlap, bad anchor, illegal stance → fail closed', async () => {
    const overlap = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({
        families: [fam('a', 'c-g1-1', [A('c-g1-1'), A('c-g2-1')])],
        unresolvedClaimIds: ['c-g3-1', 'c-g1-1'],
      }),
    });
    assert.equal(overlap.ok, false);
    assert.equal(overlap.code, 'T14_RUNTIME_OUTPUT_INVALID');

    const badAnchor = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({ families: [fam('a', 'c-g2-1', [O('c-g2-1'), A('c-g1-1'), A('c-g3-1')])], unresolvedClaimIds: [] }),
    });
    assert.equal(badAnchor.ok, false, 'an anchor that does not self-ASSERT must be refused');

    const nonMember = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({ families: [fam('a', 'c-g9-9', [A('c-g1-1'), A('c-g2-1'), A('c-g3-1')])], unresolvedClaimIds: [] }),
    });
    assert.equal(nonMember.ok, false, 'a non-member anchor must be refused');

    const badStance = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({ families: [fam('a', 'c-g1-1', [A('c-g1-1'), { claimId: 'c-g2-1', stance: 'MAYBE' }, A('c-g3-1')])], unresolvedClaimIds: [] }),
    });
    assert.equal(badStance.ok, false);
    assert.equal(badStance.code, 'T14_RUNTIME_OUTPUT_INVALID');
  });

  test('V1 `aspects` proposal is never laundered into V2 (no missing-version defaulting)', async () => {
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: base().artifact,
      runtime: v2Runtime({
        aspects: [{ aspect: '总体有效性', claimIds: ['c-g1-1', 'c-g2-1', 'c-g3-1'] }],
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_OUTPUT_INVALID');
    assert.equal(result.artifact, undefined);
  });

  test('zero legal synthesis input still fails closed T14_EMPTY_VERIFIED_INPUT (preserved)', async () => {
    const artifact = base().artifact;
    for (const group of artifact.groupRepresentations) {
      group.claims = { main: [], minority: [], contradictory: [] };
    }
    const runtime = v2Runtime({ families: [], unresolvedClaimIds: [] });
    const result = await produceCrossSourceSynthesis({ seamCArtifact: artifact, runtime });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_EMPTY_VERIFIED_INPUT');
    assert.equal(runtime.__calls.length, 0, 'no runtime invocation on empty verified input');
  });

  test('guard PASS is never a substitute for evidence closure (guard still first, runtime after)', async () => {
    const runtime = v2Runtime({ families: [], unresolvedClaimIds: [] });
    const result = await produceCrossSourceSynthesis({ seamCArtifact: base().artifact, runtime });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'T14_RUNTIME_OUTPUT_INVALID', 'both-empty proposal must fail closed even with a PASS guard');
  });
});

describe('P1-R05 V1 isolation — the producer emits V2 only; V1 stays historical', () => {
  test('real producer output is seamVersion 2 / semanticContractVersion 2 and carries no legacy claim category', async () => {
    const result = await produce(caseB());
    assert.equal(result.ok, true);
    assert.equal(result.artifact.seam, 'T14_TO_T15');
    assert.equal(result.artifact.seamVersion, 2);
    assert.equal(result.artifact.semanticContractVersion, 2);
    assert.ok(!('claims' in result.artifact.synthesis), 'V1 synthesis.claims[] must be gone');
    for (const family of result.artifact.synthesis.families) {
      assert.ok(!Object.prototype.hasOwnProperty.call(family, 'category'));
    }
  });

  test('the V2 artifact is REJECTED by the explicit V1 historical validator (no silent downgrade)', async () => {
    const result = await produce(caseA());
    assert.equal(result.ok, true);
    const v1 = validateSynthesisOutputV1Historical(result.artifact);
    assert.equal(v1.ok, false, 'a V2 artifact must never pass the V1 historical route');
  });

  test('supplied identity/hash is recomputed and compared; a tampered artifact is rejected, never healed', async () => {
    const result = await produce(caseB());
    assert.equal(result.ok, true);
    assert.equal(recomputeSynthesisIdentityV2(result.artifact), result.artifact.synthesis.synthesisIdentity);
    const tampered = JSON.parse(JSON.stringify(result.artifact));
    tampered.synthesis.families[0].relationStatus = 'SUPPORT_ONLY';
    assert.notEqual(tampered.synthesis.synthesisIdentity, recomputeSynthesisIdentityV2(tampered));
    const verdict = validateSynthesisOutputV2(tampered);
    assert.equal(verdict.ok, false);
    assert.ok(verdict.errors.some((e) => e.code === 'SEAM_D_SYNTHESIS_IDENTITY_MISMATCH' || e.code === 'SEAM_D_CLAIM_STRUCTURE_REQUIRED'));
  });
});

describe('P1-R05 identity/hash — canonical semantic state drives identity; emission order and legacy view do not', () => {
  test('array emission order permutation leaves synthesisIdentity unchanged', async () => {
    const { artifact } = caseB();
    const mk = (reverse) => v2Runtime((input) => {
      const ids = input.claims.map((c) => c.claimId);
      const ordered = reverse ? [...ids].reverse() : ids;
      return {
        families: [fam('总体有效性', 'c-g1-1', ordered.map((id) => (
          ['c-g4-1', 'c-g5-1'].includes(id) ? O(id) : A(id)
        )))],
        unresolvedClaimIds: [],
      };
    });
    const r1 = await produceCrossSourceSynthesis({ seamCArtifact: artifact, runtime: mk(false) });
    const r2 = await produceCrossSourceSynthesis({ seamCArtifact: artifact, runtime: mk(true) });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(r2.ok, true, JSON.stringify(r2));
    assert.equal(r1.artifact.synthesis.synthesisIdentity, r2.artifact.synthesis.synthesisIdentity);
  });

  test('changing stance / membership / anchor / relation status changes identity; legacy view does not', async () => {
    const baseline = await produce(caseB());
    assert.equal(baseline.ok, true);
    const base = baseline.artifact.synthesis.synthesisIdentity;

    const flipped = await produceCrossSourceSynthesis({
      seamCArtifact: caseB().artifact,
      runtime: v2Runtime({
        families: [fam('总体有效性', 'c-g1-1', [A('c-g1-1'), A('c-g4-1'), A('c-g3-1'), O('c-g2-1'), O('c-g5-1')])],
        unresolvedClaimIds: [],
      }),
    });
    assert.equal(flipped.ok, true);
    assert.notEqual(flipped.artifact.synthesis.synthesisIdentity, base, 'stance change must change canonical identity');

    // the legacy derived view is NOT part of the canonical payload
    const stripped = JSON.parse(JSON.stringify(baseline.artifact));
    delete stripped.legacyDerivedView;
    assert.equal(recomputeSynthesisIdentityV2(stripped), base, 'deleting the legacy view must not change canonical identity');
    const mutated = JSON.parse(JSON.stringify(baseline.artifact));
    mutated.legacyDerivedView.families[0].legacyCategory = 'widely-shared';
    assert.equal(recomputeSynthesisIdentityV2(mutated), base, 'mutating the legacy view must not change canonical identity');
  });
});

describe('P1-R05 LEGACY_DERIVED_VIEW — canonical → presentation, one-way only', () => {
  test('frozen mapping: CONFLICTING→conflicting; else MULTI_GROUP→widely-shared; else SINGLE_GROUP→group-specific; UNRESOLVED→null', async () => {
    const b = await produce(caseB());
    assert.equal(b.ok, true);
    assert.equal(b.artifact.legacyDerivedView.families[0].legacyCategory, 'conflicting');
    assert.equal(b.artifact.legacyDerivedView.families[0].relationStatus, 'CONFLICTING');
    assert.equal(b.artifact.legacyDerivedView.families[0].supportBreadth, 'MULTI_GROUP',
      'Case B must not lose MULTI_GROUP in the legacy view');

    const c = await produce(caseC());
    assert.equal(c.artifact.legacyDerivedView.families[0].legacyCategory, 'group-specific');

    const a = await produce(caseA());
    assert.equal(a.artifact.legacyDerivedView.families[0].legacyCategory, 'widely-shared');

    const e = await produce(caseE());
    assert.equal(e.artifact.legacyDerivedView.unresolved[0].legacyCategory, null);
    assert.equal(e.artifact.legacyDerivedView.unresolved[0].supportBreadth, null);
  });

  test('deriveLegacyView is a pure one-way projection (no reverse dependency on canonical state)', async () => {
    const result = await produce(caseB());
    const view = deriveLegacyView(result.artifact.synthesis);
    assert.deepEqual(view, result.artifact.legacyDerivedView);
    // removing the view leaves canonical identity, relations and lineage intact
    const stripped = JSON.parse(JSON.stringify(result.artifact));
    delete stripped.legacyDerivedView;
    assert.equal(validateSynthesisOutputV2(stripped).ok, true);
    assert.equal(stripped.synthesis.families[0].relationStatus, 'CONFLICTING');
    assert.equal(stripped.synthesis.families[0].supportBreadth, 'MULTI_GROUP');
  });
});

describe('P1-R05 diagnostics — derived from canonical relationStatus, five keys, T07 ownership', () => {
  test('new_contradiction_rate == CONFLICTING families / (families + unresolved) — never a legacy category', async () => {
    const b = await produce(caseB());
    assert.equal(b.ok, true);
    assert.equal(b.artifact.diagnostics.new_contradiction_rate, 1);

    const a = await produce(caseA());
    assert.equal(a.artifact.diagnostics.new_contradiction_rate, 0);

    const e = await produce(caseE());
    assert.equal(e.artifact.diagnostics.new_contradiction_rate, 0, 'UNRESOLVED is never a contradiction');

    const mixed = await produceCrossSourceSynthesis({
      seamCArtifact: seamC([
        { groupId: 'g1', claims: [{ claimId: 'c-g1-1', kind: 'main', statement: '有效', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' }] },
        { groupId: 'g2', claims: [{ claimId: 'c-g2-1', kind: 'main', statement: '无效', sourceRefs: ['g2-a-1'], authorRef: 'author-2222222222222222' }] },
        { groupId: 'g3', claims: [{ claimId: 'c-g3-1', kind: 'main', statement: '未知', sourceRefs: ['g3-a-1'], authorRef: 'author-3333333333333333' }] },
      ]),
      runtime: v2Runtime({ families: [fam('总体有效性', 'c-g1-1', [A('c-g1-1'), O('c-g2-1')])], unresolvedClaimIds: ['c-g3-1'] }),
    });
    assert.equal(mixed.ok, true, JSON.stringify(mixed));
    assert.equal(mixed.artifact.diagnostics.new_contradiction_rate, 1 / 2, '1 CONFLICTING family / (1 family + 1 unresolved)');
    assert.equal(validateSynthesisOutputV2(mixed.artifact).ok, true);
  });

  test('artifact.diagnostics carries EXACTLY the five T14-owned keys, all numeric', async () => {
    const result = await produce(caseB());
    assert.deepEqual(
      Object.keys(result.artifact.diagnostics).sort(),
      ['claim_source_diversity', 'new_aspect_rate', 'new_claim_rate', 'new_contradiction_rate', 'new_expert_rate'],
    );
    for (const value of Object.values(result.artifact.diagnostics)) {
      assert.equal(typeof value, 'number');
      assert.ok(value >= 0 && value <= 1);
    }
    // diagnostics were written through the frozen T07 hook into the coverage state
    assert.equal(result.coverageState.diagnostics.new_contradiction_rate, result.artifact.diagnostics.new_contradiction_rate);
  });

  test('prior-baseline novelty: absent prior → rates 1; a matching prior → new_*_rate 0', async () => {
    const first = await produce(caseA());
    assert.equal(first.ok, true);
    assert.equal(first.artifact.diagnostics.new_aspect_rate, 1);
    assert.equal(first.artifact.diagnostics.new_claim_rate, 1);

    const second = await produceCrossSourceSynthesis({
      seamCArtifact: caseA().artifact,
      runtime: v2Runtime(caseA().proposal),
      priorSynthesis: first.artifact.synthesis,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.artifact.diagnostics.new_aspect_rate, 0);
    assert.equal(second.artifact.diagnostics.new_claim_rate, 0);
  });
});

describe('P1-R05 real async adapter (fake transport) → T14 → V2 artifact', () => {
  test('the production DeepSeek adapter over a fake fetch feeds the real T14 producer a V2 proposal', async () => {
    const { artifact } = caseB();
    const proposal = {
      families: [fam('总体有效性', 'c-g1-1', [A('c-g1-1'), A('c-g2-1'), A('c-g3-1'), O('c-g4-1'), O('c-g5-1')])],
      unresolvedClaimIds: [],
    };
    const runtime = buildDeepSeekResearchRuntime({
      credential: { usable: true, key: 'test-key' },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          object: 'chat.completion',
          model: 'deepseek-v4-pro',
          choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }],
        }),
      }),
    });
    const result = await produceCrossSourceSynthesis({ seamCArtifact: artifact, runtime });
    assert.equal(result.ok, true, JSON.stringify(result));
    const verdict = validateSynthesisOutputV2(result.artifact);
    assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'CONFLICTING');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
  });

  test('async rejection and resolved-malformed-output keep distinct error identities', async () => {
    const rejecting = buildDeepSeekResearchRuntime({
      credential: { usable: true, key: 'test-key' },
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    const r1 = await produceCrossSourceSynthesis({ seamCArtifact: caseB().artifact, runtime: rejecting });
    assert.equal(r1.ok, false);
    assert.equal(r1.code, 'T14_RUNTIME_UNAVAILABLE', 'transport rejection must remain runtime-unavailable');

    const malformed = buildDeepSeekResearchRuntime({
      credential: { usable: true, key: 'test-key' },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          object: 'chat.completion',
          model: 'deepseek-v4-pro',
          choices: [{ message: { role: 'assistant', content: JSON.stringify({ families: [] }) }, finish_reason: 'stop' }],
        }),
      }),
    });
    const r2 = await produceCrossSourceSynthesis({ seamCArtifact: caseB().artifact, runtime: malformed });
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'T14_RUNTIME_OUTPUT_INVALID', 'resolved malformed output must remain output-invalid');
  });
});

describe('P1-R05 claim lineage — complete original lineage, no source-level dedupe loss', () => {
  test('every canonical claim reference binds sourceClaimId + statement + sourceRef + groupId + kind + authorRef', async () => {
    const result = await produce(caseB());
    assert.equal(result.ok, true);
    const seen = new Set();
    for (const family of result.artifact.synthesis.families) {
      for (const claim of family.sourceClaims) {
        assert.ok(claim.sourceClaimId && claim.statement && claim.kind);
        assert.ok(claim.sourceRefs.length > 0);
        for (const ref of claim.sourceRefs) {
          assert.ok(ref.sourceRef && ref.groupId);
          assert.ok(Object.prototype.hasOwnProperty.call(ref, 'authorRef'));
        }
        seen.add(claim.sourceClaimId);
      }
    }
    assert.equal(seen.size, 5, 'all five input claims must survive exactly once');
  });

  test('group-local contradictory is never auto-attached as opposition to unrelated main claims (F03 root cause removed)', async () => {
    // g1 carries an unrelated group-local contradictory claim; g2/g3 assert the
    // same proposition as g1's main. The contradictory must NOT oppose g1's main
    // unless the runtime actually proposes OPPOSES for it.
    const artifact = seamC([
      {
        groupId: 'g1',
        claims: [
          { claimId: 'c-g1-1', kind: 'main', statement: '该做法有效', sourceRefs: ['g1-a-1'], authorRef: 'author-1111111111111111' },
          { claimId: 'c-g1-2', kind: 'contradictory', statement: '维护成本过高（另一议题）', sourceRefs: ['g1-a-2'], authorRef: 'author-1111111111111111' },
        ],
      },
      { groupId: 'g2', claims: [{ claimId: 'c-g2-1', kind: 'main', statement: '该做法有效（第二组）', sourceRefs: ['g2-a-1'], authorRef: 'author-2222222222222222' }] },
    ]);
    const result = await produceCrossSourceSynthesis({
      seamCArtifact: artifact,
      runtime: v2Runtime({
        families: [fam('总体有效性', 'c-g1-1', [A('c-g1-1'), A('c-g2-1')])],
        unresolvedClaimIds: ['c-g1-2'],
      }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const [family] = result.artifact.synthesis.families;
    assert.equal(family.relationStatus, 'SUPPORT_ONLY', 'the unrelated group-local contradictory must not create a conflict');
    assert.deepEqual(family.oppose, [], 'no opposition may be inherited from group-local metadata');
    assert.equal(family.supportBreadth, 'MULTI_GROUP');
    // the contradictory claim survives as its own independent record with lineage
    assert.equal(result.artifact.synthesis.unresolved.length, 1);
    assert.equal(result.artifact.synthesis.unresolved[0].sourceClaim.sourceClaimId, 'c-g1-2');
    assert.equal(validateSynthesisOutputV2(result.artifact).ok, true);
  });
});
