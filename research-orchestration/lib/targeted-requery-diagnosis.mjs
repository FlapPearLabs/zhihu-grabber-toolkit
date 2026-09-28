// SPDX-License-Identifier: AGPL-3.0-only
/**
 * research-orchestration/lib/targeted-requery-diagnosis.mjs
 *
 * P2A-T03 (#115) — Gap diagnosis (provenance-coverage only, no content attribution).
 *
 * Authority (FROZEN; this module must not reinterpret, generalize or "improve" it):
 *   - docs/specs/p2-ari-f02-targeted-requery.md      §5 D1, §6                    (APPROVED)
 *   - docs/planning/..._SEAM_CONTRACT_V1.md          E.1, E.3, E.3.1, E.8
 *   - docs/planning/..._SEAM_MAP_V1.md               S1
 *   - docs/architecture/key-decisions.md             D12-1
 *
 * Ownership boundary (Ticket Graph V1 §4 — ONE_ACTIVE_WRITER_PER_BRANCH):
 *   T03 OWNS  : the diagnosis module, the provenance-coverage computation, the
 *               judgment for the three gap types, the candidate plan-owned material
 *               output (audit), the read-only guarantee, FAIL_CLOSED.
 *   T03 DOES NOT OWN (and this module deliberately contains NONE of):
 *               any text / lexical / embedding attribution or any "this content
 *               belongs to that aspect" judgment (E.3.1's hard prohibition),
 *               writes back into pool / coverage / plan (S1 ILLEGAL_STATES),
 *               authorization / dedupe / budget (T05), retrieval IO,
 *               the T01 ledger schema or file layout (CONSUMED via its primitives).
 *
 * ---------------------------------------------------------------------------
 * FROZEN SEMANTICS AND THE INTERPRETATION DECISIONS TAKEN HERE
 * (recorded explicitly so reviewers can audit the decisions instead of
 * reconstructing intent from the code)
 * ---------------------------------------------------------------------------
 *
 * 1. THE DIAGNOSIS BASIS IS PURE QUERY COVERAGE (E.3.1). A plan-owned material is
 *    COVERED when its FROZEN-normalized form appears in the provenance of an
 *    executed query. There is no content inspection anywhere in this module: no
 *    text matching beyond exact normalized equality, no lexical or embedding
 *    attribution, no "does this candidate belong to this aspect" judgment.
 *    Normalization is REUSED from T01 (`normalizeSubjectString`); this module does
 *    not contain a second normalization formula.
 *
 * 2. ONLY TWO TYPES ARE COVERAGE-DRIVEN. E.3.1 freezes exactly:
 *      ASPECT_GAP         ⟺ some plan.aspects[i] material is not covered
 *      CONTRADICTION_GAP  ⟺ some plan.opposingFramings[i] material is not covered
 *    Entities and terminologyVariants are named in E.3.1's RATIONALE as existing
 *    plan debt, but the frozen JUDGMENT names only aspects and opposingFramings —
 *    so this module deliberately does NOT invent gap types for them (that would be
 *    an unfrozen semantic extension).
 *
 * 3. AUTHORITY_GAP IS PROPOSAL-DRIVEN AND ONLY THAT (E.3.1). It cannot be proven by
 *    query coverage, so it is emitted exclusively from (a) plan.sourceGroupIntents[i]
 *    .intent (plan-owned, mechanical) or (b) an explicit proposal carrying an
 *    expectedInformation, whose subject is built by T01's frozen intent-freeform
 *    branch. Both paths run through T01's subjectKey construction — the model never
 *    receives a controller-mechanical conclusion from free text alone (S1 MUST_NOT).
 *
 * 4. COVERAGE SET CONSTRUCTION IS LENIENT BY NECESSITY AND STRICT BY MATCHING.
 *    Executed-query provenance entries that cannot normalize (e.g. a machine-private
 *    path shape) are SKIPPED: they can never equal a plan-owned material (which must
 *    normalize to be recorded by T01), and failing the whole diagnosis over one
 *    provenance entry would convert a coverage fact into an operational failure.
 *    The MATCH itself remains exact normalized equality — leniency never widens
 *    what counts as covered.
 *
 * 5. IDENTICAL NORMALIZED MATERIALS COLLAPSE. Two plan entries that normalize to the
 *    same string are the same gap subject: emitting both would produce two records
 *    with the same gapId (T01's validator refuses duplicate gapIds). The collapse is
 *    on the subject identity, not on the plan's raw text (the raw text is preserved
 *    only in the audit candidateMaterials of the first occurrence's material).
 *
 * 6. FAIL_CLOSED, TYPED. An invalid plan (per the EXISTING plan-contract validator),
 *    a malformed anchor or a malformed provenance input throws a typed error — the
 *    caller surfaces it, no gap is produced, nothing continues silently (S1).
 *
 * 7. READ-ONLY BY CONSTRUCTION. The module imports no fs/path primitive and performs
 *    no write of any kind (pinned by source guard): S1's LEGAL_STATES is
 *    READ_ONLY_INPUT and its ILLEGAL_STATES is "diagnosis writes back".
 *
 * 8. THE LEDGER ARTIFACT ITSELF IS NOT WRITTEN HERE. Diagnosis RETURNS the gap
 *    records and a fresh per-round ledger object built with T01 primitives; the
 *    persistence decision belongs to the controller (T09) using T01's own
 *    persistLedger. This keeps S1's OBSERVABLE_EFFECT (a new controller-owned
 *    artifact) with its single writer (T01 primitives) and keeps this module pure.
 *
 * 9. DETERMINISM. No clock, no randomness, no iteration-order-dependent output:
 *    the returned records are in T01's canonical gapId order (E.8 persistence
 *    shape), and identical input yields byte-identical output.
 *
 * 10. BUDGET / PRIORITY IS NOT DIAGNOSED HERE. E.8's ascending-gapId budget
 *    consumption and any attempt/dedupe accounting belong to T05/T07; this module
 *    emits the full uncovered set and lets the authorization layer bound it.
 */

import {
  appendGapRecord,
  createLedger,
  makeGapRecord,
  normalizeSubjectString,
} from './targeted-requery-ledger.mjs';
import { isValidPlanHashFormat, validatePlanInput } from './plan-contract.mjs';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** Typed error code for every fail-closed refusal in this module. */
export const DIAGNOSIS_ERROR_INVALID = 'p2a_targeted_requery_diagnosis_invalid';

// ---------------------------------------------------------------------------
// module-private helpers
// ---------------------------------------------------------------------------

function diagnosisError(message) {
  const err = new Error(message);
  err.code = DIAGNOSIS_ERROR_INVALID;
  return err;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Build the covered-material set from executed-query provenance.
 *
 * Every entry is normalized with T01's frozen normalization; entries that cannot
 * normalize are skipped (design decision 4) — they can never match a plan-owned
 * material, and leniency here never widens what counts as covered.
 */
function coveredMaterialSet(provenance) {
  const covered = new Set();
  for (let i = 0; i < provenance.length; i += 1) {
    const entry = provenance[i];
    if (typeof entry !== 'string') {
      throw diagnosisError(`executedQueryProvenance[${i}] must be a string`);
    }
    const normalized = normalizeSubjectString(entry);
    if (normalized !== null) covered.add(normalized);
  }
  return covered;
}

/**
 * Normalize one plan-owned string list into candidate materials, preserving order
 * and collapsing duplicates (design decision 5). Returns the normalized materials.
 */
function candidateMaterials(list, label) {
  if (!Array.isArray(list)) throw diagnosisError(`${label} must be an array`);
  const materials = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const normalized = normalizeSubjectString(list[i]);
    if (normalized === null) {
      throw diagnosisError(`${label}[${i}] must be a plan-boundary-safe string`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      materials.push(normalized);
    }
  }
  return materials;
}

// ---------------------------------------------------------------------------
// diagnosis
// ---------------------------------------------------------------------------

/**
 * Diagnose gaps for one (planHash, occurrenceId, diagnosisRound) round.
 *
 * Inputs (all READ-ONLY — nothing is written anywhere):
 *   plan                     verified plan object (validated by the EXISTING
 *                            plan-contract validator before anything else happens)
 *   executedQueryProvenance  the query strings recorded in the provenance of
 *                            executed queries (as recorded by P1)
 *   planHash / occurrenceId / diagnosisRound   ledger anchors (T01)
 *   proposedAuthorityGaps    optional [{ expectedInformation }] — proposal-driven
 *                            AUTHORITY_GAP candidates (E.3.1); the subject is built
 *                            by T01's frozen intent-freeform branch
 *
 * Returns { ok, ledger, records, candidateMaterials }:
 *   ledger             a fresh per-round ledger object (T01 shape, canonical order)
 *   records            the diagnosed gap records (same objects, in ledger order)
 *   candidateMaterials audit-only view of the plan-owned materials considered:
 *                      { aspectMaterials, opposingFramingMaterials, intentMaterials }
 *
 * AUTHORITY gaps from sourceGroupIntents are emitted for every plan-owned intent —
 * E.3.1 gives them no coverage criterion, so there is no "already covered" notion
 * that could suppress them at diagnosis time; bounding them is T05's job (E.8).
 */
export function diagnoseGaps({
  plan,
  executedQueryProvenance = [],
  planHash,
  occurrenceId,
  diagnosisRound,
  proposedAuthorityGaps = [],
} = {}) {
  // ---- FAIL_CLOSED gates (no gap is produced on any failure) -----------------
  if (!isValidPlanHashFormat(planHash)) throw diagnosisError('planHash must be a 64-hex plan contract hash');
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) {
    throw diagnosisError('occurrenceId must be a non-empty string');
  }
  if (!Number.isInteger(diagnosisRound) || diagnosisRound < 0) {
    throw diagnosisError('diagnosisRound must be a non-negative integer');
  }
  if (!isPlainObject(plan)) throw diagnosisError('plan must be a plain object');
  const planVerdict = validatePlanInput(plan);
  if (!planVerdict.ok) throw diagnosisError('plan is not a valid verified plan (plan-contract)');
  if (!Array.isArray(executedQueryProvenance)) {
    throw diagnosisError('executedQueryProvenance must be an array of executed query strings');
  }
  if (!Array.isArray(proposedAuthorityGaps)) {
    throw diagnosisError('proposedAuthorityGaps must be an array of { expectedInformation }');
  }
  for (let i = 0; i < proposedAuthorityGaps.length; i += 1) {
    const candidate = proposedAuthorityGaps[i];
    if (!isPlainObject(candidate) || typeof candidate.expectedInformation !== 'string') {
      throw diagnosisError(`proposedAuthorityGaps[${i}] must be { expectedInformation: string }`);
    }
  }

  // ---- candidate plan-owned materials (audit) --------------------------------
  const verifiedPlan = planVerdict.plan;
  const aspectMaterials = candidateMaterials(verifiedPlan.aspects, 'plan.aspects');
  const opposingFramingMaterials = candidateMaterials(verifiedPlan.opposingFramings, 'plan.opposingFramings');
  const intentMaterials = candidateMaterials(
    verifiedPlan.sourceGroupIntents.map((entry) => entry.intent),
    'plan.sourceGroupIntents[].intent',
  );

  // ---- coverage set (provenance-based, E.3.1) --------------------------------
  const covered = coveredMaterialSet(executedQueryProvenance);

  // ---- build the gap records through T01's frozen primitives -----------------
  const ledger = createLedger({ planHash, occurrenceId });

  // T01's own append primitive validates AND keeps the canonical E.8 order —
  // this module never re-implements either.
  const append = (record) => {
    const next = appendGapRecord(ledger, record);
    ledger.diagnosedGaps = next.diagnosedGaps;
  };

  // E.3.1 branch 1: uncovered aspects → ASPECT_GAP (coverage-driven)
  for (const material of aspectMaterials) {
    if (!covered.has(material)) {
      append(makeGapRecord({
        planHash,
        occurrenceId,
        diagnosisRound,
        gapType: 'ASPECT_GAP',
        subject: { kind: 'aspect', value: material },
      }));
    }
  }

  // E.3.1 branch 2: uncovered opposing framings → CONTRADICTION_GAP (coverage-driven)
  for (const material of opposingFramingMaterials) {
    if (!covered.has(material)) {
      append(makeGapRecord({
        planHash,
        occurrenceId,
        diagnosisRound,
        gapType: 'CONTRADICTION_GAP',
        subject: { kind: 'opposingFraming', value: material },
      }));
    }
  }

  // E.3.1 branch 3: AUTHORITY_GAP is proposal-driven only — never coverage-driven.
  for (const material of intentMaterials) {
    const intent = verifiedPlan.sourceGroupIntents
      .map((entry) => entry.intent)
      .find((value) => normalizeSubjectString(value) === material);
    append(makeGapRecord({
      planHash,
      occurrenceId,
      diagnosisRound,
      gapType: 'AUTHORITY_GAP',
      subject: { kind: 'sourceGroupIntent', intent },
    }));
  }
  for (const candidate of proposedAuthorityGaps) {
    if (normalizeSubjectString(candidate.expectedInformation) === null) {
      throw diagnosisError('proposedAuthorityGaps expectedInformation must be a plan-boundary-safe string');
    }
    append(makeGapRecord({
      planHash,
      occurrenceId,
      diagnosisRound,
      gapType: 'AUTHORITY_GAP',
      subject: { kind: 'sourceGroupIntent', queryIntent: candidate.expectedInformation },
    }));
  }

  return {
    ok: true,
    ledger,
    records: ledger.diagnosedGaps,
    candidateMaterials: {
      aspectMaterials,
      opposingFramingMaterials,
      intentMaterials,
    },
  };
}
