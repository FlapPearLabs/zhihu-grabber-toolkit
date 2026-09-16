/**
 * research-orchestration/test/p1-claims-prompt-contract.test.mjs
 *
 * P1-T13 — CLAIMS_SYSTEM_PROMPT semantic contract test for expertEvidenceRichTokens.
 * Verifies that the prompt rule adheres strictly to the frozen semantic boundary:
 *   1. No originality provenance claim beyond model authority (NO '原创');
 *   2. No expert-identity implication (evidence-rich candidate only);
 *   3. No verified-evidence implication (candidate annotation, unverified by controller);
 *   4. Substantive observable signals (reproducible code/benchmark, paper/doc citations,
 *      quantitative data, chart/formula);
 *   5. Negative exclusion rules and uncertain -> exclude fail-closed discipline.
 * Also verifies the 8-case counterexample fixture schema and expectations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_PATH = path.join(TEST_DIR, '..', 'lib', 'deepseek-research-runtime.mjs');
const FIXTURE_PATH = path.join(TEST_DIR, 'fixtures', 'claims-evidence-counterexamples.json');

describe('CLAIMS_SYSTEM_PROMPT Rule 5 Semantic Contract', () => {
  test('Rule 5 text exists and adheres to the frozen semantic boundary', () => {
    const runtimeSource = fs.readFileSync(RUNTIME_PATH, 'utf8');

    // Rule 5 must exist in source
    assert.match(runtimeSource, /5\.\s*expertEvidenceRichTokens/);

    // Invariant 1: No originality provenance claim
    assert.doesNotMatch(runtimeSource, /原创代码/, 'Prompt must NOT claim originality authority (beyond model capability)');

    // Invariant 2: Explicit candidate demarcation
    assert.match(runtimeSource, /只标记“证据丰富候选”/, 'Prompt must clearly mark candidate status');
    assert.match(runtimeSource, /不代表作者专家身份/, 'Prompt must disclaim author expertise');

    // Invariant 3: Explicit unverified demarcation
    assert.match(runtimeSource, /也不代表证据已被外部验证/, 'Prompt must disclaim external verification authority');

    // Invariant 4: Substantive support requirement
    assert.match(runtimeSource, /与主要观点直接相关、可定位的实质证据/, 'Prompt must require direct substantive support');

    // Invariant 5: Broad observable signal spectrum (no accidental narrowing)
    assert.match(runtimeSource, /可复核的代码实现及运行\/实验\/性能结果/, 'Prompt must cover reproducible code/benchmark');
    assert.match(runtimeSource, /与论点直接相关的论文、数据集或官方文档引用/, 'Prompt must cover relevant citations');
    assert.match(runtimeSource, /带明确来源、样本\/方法或可核查数值的定量\/一手数据/, 'Prompt must cover quantitative data');
    assert.match(runtimeSource, /直接支持论点的图表或公式/, 'Prompt must cover charts and formulas');

    // Invariant 6: Anti-gaming negative constraints
    assert.match(runtimeSource, /仅出现代码块、链接、论文名、机构名、数字或“本人实测”等字样不足以收录/, 'Prompt must reject bare surface tokens');

    // Invariant 7: Uncertain -> exclude
    assert.match(runtimeSource, /无法确认则不收录/, 'Prompt must enforce uncertain -> exclude fail-closed fallback');
  });

  test('8-case counterexample fixture covers all required semantic scenarios', () => {
    assert.ok(fs.existsSync(FIXTURE_PATH), 'Counterexample fixture must exist');
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

    assert.ok(Array.isArray(fixture.cases), 'Fixture must contain cases array');
    assert.equal(fixture.cases.length, 8, 'Must cover exactly 8 targeted cases (A through H)');

    const caseIds = fixture.cases.map(c => c.id);
    const expectedIds = ['CASE_A', 'CASE_B', 'CASE_C', 'CASE_D', 'CASE_E', 'CASE_F', 'CASE_G', 'CASE_H'];
    assert.deepEqual(caseIds, expectedIds, 'Must contain all case IDs from CASE_A to CASE_H');

    // 4 Negative cases (A, B, C, D)
    const negativeCases = fixture.cases.filter(c => !c.expectedEvidenceRich);
    assert.equal(negativeCases.length, 4, 'Must have 4 negative counterexamples');
    assert.deepEqual(negativeCases.map(c => c.id), ['CASE_A', 'CASE_B', 'CASE_C', 'CASE_D']);
    for (const c of negativeCases) {
      assert.deepEqual(c.expectedTokens, [], `${c.id} expectedTokens must be empty`);
      assert.ok(c.rationale.length > 10, `${c.id} must include substantive rationale`);
    }

    // 4 Positive candidate cases (E, F, G, H)
    const positiveCases = fixture.cases.filter(c => c.expectedEvidenceRich);
    assert.equal(positiveCases.length, 4, 'Must have 4 positive evidence-rich candidate counterexamples');
    assert.deepEqual(positiveCases.map(c => c.id), ['CASE_E', 'CASE_F', 'CASE_G', 'CASE_H']);
    for (const c of positiveCases) {
      assert.equal(c.expectedTokens.length, 1, `${c.id} expectedTokens must contain 1 token`);
      assert.equal(c.expectedTokens[0], c.tokenRef, `${c.id} tokenRef must match`);
      assert.ok(c.rationale.length > 10, `${c.id} must include substantive rationale`);
    }
  });
});
