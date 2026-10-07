#!/usr/bin/env node
// Draft-only evidence packager. It preserves campaign verdicts and never creates a review receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [campaignArg, outputArg] = process.argv.slice(2);
if (!campaignArg || !outputArg) {
  console.error('Usage: node package-evidence.mjs <campaign-dir> <new-output-dir>');
  process.exit(2);
}
const sourceRoot = path.resolve(campaignArg);
const outputRoot = path.resolve(outputArg);
if (sourceRoot === outputRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('Output must be outside the input campaign');
if (fs.existsSync(outputRoot)) throw new Error('Output directory already exists; choose a fresh output directory');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const safeRel = rel => typeof rel === 'string' && rel.length > 0 && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..');
const campaign = readJson(path.join(sourceRoot, 'campaign.json'));
if (!Array.isArray(campaign.scenarios)) throw new Error('campaign.json has no scenarios array');
fs.mkdirSync(outputRoot, { recursive: true });

const manifest = {
  schema: 'p2a-t14-evidence-package-draft/v1',
  sourceCampaignRef: { path: 'source-campaign.json', sha256: null },
  sourceExactRepoSha: campaign.exactRepoSha ?? 'UNKNOWN',
  sourceCampaignVerdict: campaign.verdict ?? 'UNKNOWN',
  finalReviewReceipt: 'NOT_CREATED',
  scenarios: [],
};
const campaignBytes = fs.readFileSync(path.join(sourceRoot, 'campaign.json'));

const index = { schema: 'p2a-t14-lineage-index-draft/v1', scenarios: [] };
const validation = { schema: 'p2a-t14-package-validation/v1', inputChecks: [], outputChecks: [], pathAndSecretChecks: [], errors: [] };
const minimumSuggestions = [];

function collectStrings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach(v => collectStrings(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, found));
  return found;
}
const absoluteRe = /(?:^|["'\s])(?:\/(?:Users|tmp|private|home|var)\/|[A-Za-z]:\\)/;
const secretKeyRe = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|authorization|password|secret)/i;
function checkContent(label, bytes) {
  const raw = bytes.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const textValues = parsed ? collectStrings(parsed) : [raw];
  const absolute = textValues.some(v => absoluteRe.test(v));
  const secretKey = parsed && typeof parsed === 'object'
    ? Object.keys(parsed).some(k => secretKeyRe.test(k))
    : false;
  const tokenValue = /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/.test(raw);
  validation.pathAndSecretChecks.push({ ref: label, absolutePathFound: absolute, secretIndicatorFound: secretKey || tokenValue });
  return !absolute && !secretKey && !tokenValue;
}

if (!checkContent('source-campaign.json', campaignBytes)) throw new Error('campaign contains absolute path or secret indicator');
fs.writeFileSync(path.join(outputRoot, 'source-campaign.json'), campaignBytes);
manifest.sourceCampaignRef.sha256 = sha(campaignBytes);

for (const scenarioEntry of campaign.scenarios) {
  const scenarioId = String(scenarioEntry.scenarioId ?? scenarioEntry.id ?? 'UNKNOWN');
  if (!/^[a-z0-9-]+$/i.test(scenarioId)) { validation.errors.push(`unsafe scenario id ${scenarioId}`); continue; }
  const scenarioDir = path.join(sourceRoot, scenarioId);
  const evidenceFile = path.join(scenarioDir, 'evidence.json');
  if (!fs.existsSync(evidenceFile)) {
    manifest.scenarios.push({ scenarioId, sourceVerdict: scenarioEntry.verdict ?? 'UNKNOWN', verdict: 'UNKNOWN', reason: 'evidence.json missing' });
    validation.errors.push(`${scenarioId}: evidence.json missing`);
    continue;
  }
  const evidence = readJson(evidenceFile);
  const isResolutionCrash = ['crash-resolution-input', 'crash-resolution-reverse', 'crash-framing-drift'].includes(scenarioId);
  const crashRequiredChecks = ['same occurrence resumes', 'real kill at window', 'original and resume planned ids drift bidirectionally',
    'targeted provider delta is zero', 'one checkpoint-anchored COMMIT with valid result hash',
    'original T08 snapshot bound before provider IO', 'snapshot prior IDs match initial provider facts',
    'snapshot bytes and hash survive COMPLETE ordinary resume'];
  if (isResolutionCrash) {
    const checks = new Map((evidence.checks ?? []).map(c => [c.name, c]));
    const requiredChecks = scenarioId === 'crash-framing-drift'
      ? ['framing provider coverage drifts across crash and resume', 'framing targeted result is new evidence',
        'framing T08 uses original snapshot classification', 'framing targeted resume delta is zero',
        'framing resume proposal only references prior anchored gap', 'framing snapshot bound before provider IO',
        'framing snapshot prior IDs match initial provider facts', 'framing snapshot survives COMPLETE ordinary resume', 'framing feedback loop has actual budget STOP', 'framing has one anchored COMMIT']
      : crashRequiredChecks;
    for (const name of requiredChecks) if (checks.get(name)?.pass !== true) validation.errors.push(`${scenarioId}: missing or failed required crash-resolution check ${name}`);
    if (!Array.isArray(evidence.crashResolution?.originalPlannedIds) || !Array.isArray(evidence.crashResolution?.resumePlannedIds)
      || !Array.isArray(evidence.crashResolution?.targetedIds) || evidence.crashResolution?.targetedProviderCallDelta !== 0
      || !/^[0-9a-f]{64}$/.test(evidence.crashResolution?.artifactHash ?? '')
      || evidence.crashResolution?.commitCount !== 1 || !evidence.crashResolution?.initialBindingValid || !evidence.crashResolution?.finalBindingValid
      || evidence.crashResolution?.resolutionInput?.preIoCheckpointBindingValid !== true
      || evidence.crashResolution?.resolutionInput?.priorIdsMatchInitialProviderFacts !== true
      || evidence.crashResolution?.resolutionInput?.retainedHashAndBytesOnCompleteResume !== true
      || !/^[0-9a-f]{64}$/.test(evidence.crashResolution?.resolutionInput?.bindingHash ?? '')
      || evidence.crashResolution?.resolutionInput?.bindingHash !== evidence.crashResolution?.resolutionInput?.byteHash) {
      validation.errors.push(`${scenarioId}: crash-resolution evidence fields are incomplete or invalid`);
    }
  }
  const initialFile = path.join(scenarioDir, 'initial-observation.json');
  const finalFile = path.join(scenarioDir, 'final-observation.json');
  const initial = fs.existsSync(initialFile) ? readJson(initialFile) : null;
  const final = fs.existsSync(finalFile) ? readJson(finalFile) : null;
  const workDir = path.join(scenarioDir, 'work');
  const scenarioOut = path.join(outputRoot, 'evidence', scenarioId);
  fs.mkdirSync(scenarioOut, { recursive: true });
  const evidenceBytes = fs.readFileSync(evidenceFile);
  const evidenceRef = `evidence/${scenarioId}/evidence-record.json`;
  if (!checkContent(evidenceRef, evidenceBytes)) validation.errors.push(`${scenarioId}: excluded path/secret indicator in evidence.json`);
  else {
    fs.writeFileSync(path.join(outputRoot, evidenceRef), evidenceBytes, { flag: 'wx' });
    const packagedEvidence = { path: evidenceRef, sha256: sha(evidenceBytes), bytes: evidenceBytes.length };
    validation.inputChecks.push({ scenarioId, sourceRef: 'evidence.json', exists: true, sha256: sha(evidenceBytes), hashMatchesRecordedEvidence: true });
    validation.outputChecks.push({ owner: scenarioId, ref: evidenceRef, exists: true, hashMatches: sha(fs.readFileSync(path.join(outputRoot, evidenceRef))) === packagedEvidence.sha256 });
  }

  const requiredRefs = new Set([
    'orchestration-state.json', 'research-plan.json', 'targeted-requery-ledger.json',
    'targeted-requery-actions.json', 'targeted-requery-resolution.json',
    'events.jsonl', 'acceptance-provider-calls.jsonl',
    'research-result.json', 'coverage-final.json',
  ]);
  if (scenarioId === 'crash-framing-drift') requiredRefs.add('acceptance-events.jsonl');
  if (isResolutionCrash) {
    for (const rel of ['events.jsonl', 'acceptance-provider-calls.jsonl', 'orchestration-state.json', 'targeted-requery-actions.json',
      'targeted-requery-resolution.json', 'research-result.json', 'coverage-final.json',
      'acceptance-compose-resume.json', 'acceptance-compose-complete-resume.json']) requiredRefs.add(rel);
  }
  for (const item of [...(evidence.inputArtifacts ?? []), ...(evidence.outputArtifacts ?? [])]) {
    if (item?.path && /^(?:acceptance-compose-|retrieval-rounds\/|targeted-requery-subphase\/)/.test(item.path)) requiredRefs.add(item.path);
  }
  for (const observation of [initial, final]) {
    for (const [key, sha] of Object.entries(observation?.state?.hashes ?? {})) {
      if (/^targeted-resolution-input:[0-9a-f]{64}$/.test(key) && /^[0-9a-f]{64}$/.test(sha)) {
        requiredRefs.add(`.p1-commit-staging/targeted-resolution-input/${sha}.json`);
      }
    }
    for (const action of [...(observation?.actions?.targetedActions ?? []), ...(observation?.anchoredActions?.targetedActions ?? [])]) if (action.artifactRel) requiredRefs.add(action.artifactRel);
    const ledgerHash = observation?.state?.hashes?.['targeted-action-ledger'];
    if (ledgerHash) {
      const anchored = observation?.inventory?.find(a => a.path === `.p1-commit-staging/targeted-action-ledger/${ledgerHash}.json`);
      if (anchored) requiredRefs.add(anchored.path);
    }
  }
  const controllerControlsPath = path.join(workDir, 'acceptance-controller-controls.json');
  if (fs.existsSync(controllerControlsPath)) requiredRefs.add('acceptance-controller-controls.json');
  const staleActionControlPath = path.join(workDir, 'acceptance-stale-action-control.json');
  if (scenarioId === 'stale-action' && fs.existsSync(staleActionControlPath)) requiredRefs.add('acceptance-stale-action-control.json');
  const staleCheckpointBackupPath = path.join(workDir, 'acceptance-stale-action-checkpoint-original.json');
  if (scenarioId === 'stale-action' && fs.existsSync(staleCheckpointBackupPath)) requiredRefs.add('acceptance-stale-action-checkpoint-original.json');
  const packagedRefs = evidenceBytes.length > 0 && fs.existsSync(path.join(outputRoot, evidenceRef))
    ? [{ path: evidenceRef, sha256: sha(evidenceBytes), bytes: evidenceBytes.length }]
    : [];
  const faultEvidenceRefs = [];
  const isExpectedFaultRef = rel => {
    if (evidence.fault?.artifact === rel || evidence.fault?.removedStagingArtifact === rel) return true;
    if (evidence.fault?.kind === 'delete-real-produced-resolution' && rel === 'targeted-requery-resolution.json') return true;
    if (evidence.fault?.kind === 'mutate-real-produced-resolution' || evidence.fault?.kind === 'foreign-occurrence-resolution') return rel === 'targeted-requery-resolution.json';
    return false;
  };
  const missingRequiredRefs = [];
  for (const rel of [...requiredRefs].sort()) {
    if (!safeRel(rel)) { validation.errors.push(`${scenarioId}: unsafe ref ${rel}`); continue; }
    const sourceFile = path.join(workDir, rel);
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      validation.inputChecks.push({ scenarioId, ref: rel, exists: false, hashMatchesInventory: false });
      if (isExpectedFaultRef(rel)) {
        const initialHash = initial?.inventory?.find(x => x.path === rel)?.sha256 ?? evidence.fault?.beforeHash ?? 'UNKNOWN';
        faultEvidenceRefs.push({ ref: rel, phase: 'initial', sha256: initialHash, bytesAvailableInCurrentWorktree: false, classification: 'FAULT_EVIDENCE_EXPECTED_MISSING_AFTER_INJECTION' });
      } else missingRequiredRefs.push(rel);
      continue;
    }
    const bytes = fs.readFileSync(sourceFile);
    const sourceHash = sha(bytes);
    const inventoryEntries = [...(initial?.inventory ?? []), ...(final?.inventory ?? [])].filter(x => x.path === rel);
    const inventoryMatch = inventoryEntries.length === 0 || inventoryEntries.some(x => x.sha256 === sourceHash);
    validation.inputChecks.push({ scenarioId, ref: rel, exists: true, sha256: sourceHash, hashMatchesInventory: inventoryMatch });
    if (!inventoryMatch) validation.errors.push(`${scenarioId}: source hash differs from observation inventory: ${rel}`);
    if (!checkContent(`${scenarioId}/${rel}`, bytes)) {
      validation.errors.push(`${scenarioId}: excluded path/secret indicator in ${rel}`);
      continue;
    }
    const destinationRel = `evidence/${scenarioId}/${rel}`;
    const destination = path.join(outputRoot, destinationRel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    packagedRefs.push({ path: destinationRel, sha256: sha(bytes), bytes: bytes.length });
  }

  for (const observation of [initial, final]) {
    const phase = observation === initial ? 'initial' : 'final';
    if (!observation) continue;
    const targetedResultRefs = new Set((observation.actions?.targetedActions ?? []).map(a => a.artifactRel).filter(Boolean));
    const snapshot = {
      schema: 'p2a-t14-observation-summary/v1', phase,
      exactRepoSha: observation.exactRepoSha ?? 'UNKNOWN', runId: observation.runId ?? 'UNKNOWN', occurrenceId: observation.occurrenceId ?? 'UNKNOWN',
      planHash: observation.gaps?.planHash ?? observation.state?.hashes?.researchPlan ?? 'UNKNOWN',
      stateHashes: observation.state?.hashes ?? 'UNKNOWN',
      diagnosedGaps: observation.gaps?.diagnosedGaps ?? 'NOT_PROVEN',
      actions: observation.actions?.targetedActions ?? 'NOT_PROVEN',
      anchoredActions: observation.anchoredActions?.targetedActions ?? 'NOT_PROVEN',
      resolutions: observation.resolution?.resolutions ?? 'NOT_PROVEN',
      providerCalls: (observation.calls ?? []).map(c => ({ sequence: c.sequence ?? 'UNKNOWN', phase: c.phase ?? 'UNKNOWN', kind: c.kind ?? 'UNKNOWN', query: c.query ?? 'UNKNOWN', providerId: c.providerId ?? c.output?.provider_id ?? 'UNKNOWN', capability: c.capability ?? c.output?.capability ?? 'UNKNOWN', questionIds: (c.output?.items ?? []).map(i => i.identity?.questionId).filter(Boolean) })),
      acceptanceEvents: observation.acceptanceEvents ?? 'NOT_PROVEN',
      finalArtifactHashes: Object.fromEntries((observation.inventory ?? []).filter(x => ['research-result.json', 'coverage-final.json', 'targeted-requery-resolution.json'].includes(x.path)).map(x => [x.path, x.sha256])),
      targetedPoolHashes: Object.fromEntries((observation.inventory ?? []).filter(x => targetedResultRefs.has(x.path)).map(x => [x.path, x.sha256])),
      anchoredLedgerSnapshots: (observation.inventory ?? []).filter(x => x.path.includes('.p1-commit-staging/targeted-action-ledger/')),
      faultSnapshot: evidence.fault ?? null,
      faultArtifactHashes: evidence.fault?.artifact ? {
        ref: evidence.fault.artifact,
        initialObservationHash: initial?.inventory?.find(x => x.path === evidence.fault.artifact)?.sha256 ?? evidence.fault.beforeHash ?? 'UNKNOWN',
        currentWorktreeHash: fs.existsSync(path.join(workDir, evidence.fault.artifact)) ? sha(fs.readFileSync(path.join(workDir, evidence.fault.artifact))) : 'MISSING',
        currentBytesAreAfterFaultOnly: !!evidence.fault.beforeHash && !!evidence.fault.afterHash && evidence.fault.beforeHash !== evidence.fault.afterHash,
        preFaultObservationSnapshotIncluded: !!initial,
        originalPreFaultBytesCopied: false,
      } : null,
    };
    const rel = `evidence/${scenarioId}/${phase}-observation-summary.json`;
    const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
    if (!checkContent(rel, bytes)) validation.errors.push(`${scenarioId}: excluded path/secret indicator in ${phase} observation summary`);
    else {
      fs.writeFileSync(path.join(outputRoot, rel), bytes, { flag: 'wx' });
      packagedRefs.push({ path: rel, sha256: sha(bytes), bytes: bytes.length });
      validation.outputChecks.push({ owner: scenarioId, ref: rel, exists: true, hashMatches: sha(fs.readFileSync(path.join(outputRoot, rel))) === sha(bytes) });
    }
  }

  const observedInventory = [...(initial?.inventory ?? []), ...(final?.inventory ?? [])];
  const evidenceInventory = [...(evidence.inputArtifacts ?? []), ...(evidence.outputArtifacts ?? [])];
  for (const item of [...observedInventory, ...evidenceInventory]) {
    if (!item?.path || !item?.sha256) continue;
    const rel = item.path;
    if (!safeRel(rel)) { validation.errors.push(`${scenarioId}: unsafe source artifact ref ${rel}`); continue; }
    const file = path.join(workDir, rel);
    const exists = fs.existsSync(file) && fs.statSync(file).isFile();
    const actual = exists ? sha(fs.readFileSync(file)) : null;
    const samePathEntries = [...observedInventory, ...evidenceInventory].filter(x => x?.path === rel && x?.sha256);
    const validHash = exists && samePathEntries.some(x => x.sha256 === actual);
    validation.inputChecks.push({ scenarioId, sourceRef: rel, exists, hashMatchesAnyRecordedVersion: validHash });
    if ((!exists || !validHash) && !isExpectedFaultRef(rel)) validation.errors.push(`${scenarioId}: source artifact ref missing/hash mismatch ${rel}`);
    else if ((!exists || !validHash) && isExpectedFaultRef(rel)) {
      if (!faultEvidenceRefs.some(x => x.ref === rel)) {
        faultEvidenceRefs.push({ ref: rel, phase: 'initial', sha256: initial?.inventory?.find(x => x.path === rel)?.sha256 ?? evidence.fault?.beforeHash ?? 'UNKNOWN', bytesAvailableInCurrentWorktree: false, classification: 'FAULT_EVIDENCE_EXPECTED_MISSING_OR_CHANGED_AFTER_INJECTION' });
      }
    }
  }

  const gaps = final?.gaps?.diagnosedGaps ?? initial?.gaps?.diagnosedGaps ?? [];
  const actions = final?.actions?.targetedActions ?? initial?.actions?.targetedActions ?? [];
  const calls = final?.calls ?? initial?.calls ?? [];
  const checkpoint = final?.state?.hashes ?? initial?.state?.hashes ?? null;
  const finalHashes = Object.fromEntries((final?.inventory ?? initial?.inventory ?? [])
    .filter(x => ['research-result.json', 'coverage-final.json'].includes(x.path))
    .map(x => [x.path, x.sha256]));
  const scenarioIndex = {
    scenarioId,
    exactRepoSha: evidence.exactRepoSha ?? 'UNKNOWN',
    runId: evidence.runId ?? initial?.runId ?? 'UNKNOWN',
    occurrenceId: evidence.occurrenceId ?? initial?.occurrenceId ?? 'UNKNOWN',
    planId: evidence.planId ?? 'UNKNOWN',
    planRef: packagedRefs.find(r => r.path.endsWith('/research-plan.json')) ?? null,
    sourceVerdict: evidence.verdict ?? scenarioEntry.verdict ?? 'UNKNOWN',
    checks: (evidence.checks ?? []).map(c => ({ name: c.name, pass: c.pass, actual: c.actual ?? null, expected: c.expected ?? null })),
    gapIndexStatus: (final?.gaps?.diagnosedGaps ?? initial?.gaps?.diagnosedGaps) ? 'OBSERVED' : 'NOT_PROVEN',
    gaps: gaps.map(g => ({ gapId: g.gapId ?? 'UNKNOWN', gapType: g.gapType ?? 'UNKNOWN', occurrenceId: g.occurrenceId ?? 'UNKNOWN', planHash: g.planHash ?? 'UNKNOWN' })),
    actionIndexStatus: (final?.actions?.targetedActions ?? initial?.actions?.targetedActions) ? 'OBSERVED' : 'NOT_PROVEN',
    actions: actions.map(a => ({ targetedActionId: a.targetedActionId ?? 'UNKNOWN', gapId: a.gapId ?? 'UNKNOWN', occurrenceId: a.occurrenceId ?? 'UNKNOWN', normalizedQuery: a.normalizedQuery ?? 'UNKNOWN', providerScope: a.providerScope ?? 'UNKNOWN', status: a.status ?? 'UNKNOWN', artifactRel: a.artifactRel ?? 'UNKNOWN', artifactHash: a.artifactHash ?? 'UNKNOWN' })),
    ...(isResolutionCrash ? { crashResolution: evidence.crashResolution ?? 'NOT_PROVEN' } : {}),
    resolutionInputs: (final?.resolutionInputs ?? initial?.resolutionInputs ?? []).map(input => ({ targetedActionId: input.targetedActionId ?? 'UNKNOWN',
      gapId: input.gapId ?? 'UNKNOWN', planHash: input.planHash ?? 'UNKNOWN', occurrenceId: input.occurrenceId ?? 'UNKNOWN',
      key: input.key ?? 'UNKNOWN', bindingHash: input.bindingHash ?? 'UNKNOWN', byteHash: input.byteHash ?? 'UNKNOWN',
      byteLength: input.byteLength ?? 'UNKNOWN', snapshot: input.snapshot ?? 'NOT_PROVEN' })),
    providerCallIndexStatus: (final?.calls ?? initial?.calls) ? 'OBSERVED' : 'NOT_PROVEN',
    providerCalls: calls.map(c => ({ sequence: c.sequence ?? 'UNKNOWN', phase: c.phase ?? 'UNKNOWN', kind: c.kind ?? 'UNKNOWN', query: c.query ?? 'UNKNOWN', providerId: c.providerId ?? c.output?.provider_id ?? 'UNKNOWN', capability: c.capability ?? c.output?.capability ?? 'UNKNOWN', questionIds: (c.output?.items ?? []).map(i => i.identity?.questionId).filter(Boolean) })),
    checkpointHashes: checkpoint ?? 'UNKNOWN',
    finalArtifactHashStatus: Object.keys(finalHashes).length === 2 ? 'OBSERVED' : 'NOT_PROVEN',
    missingRequiredArtifactRefs: missingRequiredRefs,
    artifactSetStatus: missingRequiredRefs.length === 0 ? 'OBSERVED' : 'NOT_PROVEN',
    faultEvidenceRefs,
    finalArtifactHashes: finalHashes,
    refs: packagedRefs,
  };
  index.scenarios.push(scenarioIndex);
  manifest.scenarios.push({ scenarioId, sourceVerdict: scenarioIndex.sourceVerdict, verdict: scenarioIndex.sourceVerdict, refs: packagedRefs.map(r => ({ path: r.path, sha256: r.sha256, bytes: r.bytes })) });
  minimumSuggestions.push({ scenarioId, minimumForReview: ['evidence.json', 'work/orchestration-state.json', 'work/research-plan.json', 'work/targeted-requery-ledger.json', 'work/targeted-requery-actions.json', 'work/targeted-requery-resolution.json', 'work/.p1-commit-staging/targeted-action-ledger/<checkpoint-hash>.json', 'work/events.jsonl (actual controller trace)', 'work/acceptance-provider-calls.jsonl', 'work/acceptance-controller-controls.json when present', 'work/acceptance-stale-action-control.json and original checkpoint backup for stale-action', 'work/research-result.json', 'work/coverage-final.json', 'work/<action.artifactRel>', 'initial/final observation summary snapshots', ...(isResolutionCrash ? ['work/acceptance-compose-resume.json', 'work/acceptance-compose-complete-resume.json', 'initial/final planned-ID sets', 'targeted provider delta', 'T08 status and resolutionBasis', 'original checkpoint-bound resolution-input bytes/hash', 'single COMMIT with initial/final checkpoint result hash'] : [])], faultHandling: 'Preserve pre-fault observation snapshot and recorded hash; label current changed bytes as post-fault; classify deleted fault artifacts as FAULT_EVIDENCE, never as valid pre-fault bytes.', excludedByDefault: ['zhihu/** capture/corpus payloads', 'large logs', 'full initial/final observation snapshots'] });
}

function recursivelyCheckRefs(value, owner, checks = []) {
  if (Array.isArray(value)) { value.forEach(v => recursivelyCheckRefs(v, owner, checks)); return checks; }
  if (!value || typeof value !== 'object') return checks;
  if (typeof value.path === 'string' && typeof value.sha256 === 'string') {
    const ref = value.path;
    const file = path.join(outputRoot, ref);
    const exists = safeRel(ref) && fs.existsSync(file) && fs.statSync(file).isFile();
    const actual = exists ? sha(fs.readFileSync(file)) : null;
    checks.push({ owner, ref, exists, hashMatches: exists && actual === value.sha256 });
    if (!exists || actual !== value.sha256) validation.errors.push(`${owner}: output ref missing/hash mismatch ${ref}`);
  }
  Object.values(value).forEach(v => recursivelyCheckRefs(v, owner, checks));
  return checks;
}

fs.writeFileSync(path.join(outputRoot, 'source-campaign.json'), `${JSON.stringify(campaign, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'scenario-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'lineage-index.json'), `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'minimum-file-selection.json'), `${JSON.stringify({ schema: 'p2a-t14-minimum-review-files/v1', scenarios: minimumSuggestions }, null, 2)}\n`);
validation.outputChecks = recursivelyCheckRefs({ manifest, index }, 'package');
validation.exitStatus = validation.errors.length === 0 ? 'STRUCTURAL_CHECKS_OK' : 'STRUCTURAL_CHECKS_FAILED';
validation.errors = [...new Set(validation.errors)];
fs.writeFileSync(path.join(outputRoot, 'validation.json'), `${JSON.stringify(validation, null, 2)}\n`);
console.log(JSON.stringify({ outputRoot, scenarios: manifest.scenarios.length, campaignVerdictPreserved: manifest.sourceCampaignVerdict, structuralStatus: validation.exitStatus, errors: validation.errors.length }, null, 2));
process.exitCode = validation.errors.length ? 1 : 0;
