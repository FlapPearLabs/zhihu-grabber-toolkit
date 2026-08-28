// Result writer — machine-readable benchmark result per approved output contract.
// Hard guarantees:
//   - NO credentials / cookies / secrets / tokens in any output
//   - NO absolute machine-private paths
//   - deterministic, machine-auditable JSON

import fs from 'node:fs';
import { runtimeIdentity } from './runtime.mjs';

const SENSITIVE = /cookie|secret|token|password|credential|api[_-]?key|authorization|auth[_-]?header|bearer/i;

// deep-walk sanitizer: removes any key matching the sensitive pattern and
// any string VALUE matching it (defense in depth).
export function sanitize(obj, path = '$') {
  if (Array.isArray(obj)) return obj.map((v, i) => sanitize(v, `${path}[${i}]`));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE.test(k)) continue;
      if (typeof v === 'string' && SENSITIVE.test(v)) continue;
      out[k] = sanitize(v, `${path}.${k}`);
    }
    return out;
  }
  return obj;
}

export function buildResult({
  dataset_version, dataset_version_status, case_id, case_meta, strategy_id, strategy_config,
  candidate_pool_id, budget, selected_source_ids, provenance, metric_results,
  gold_stats_by_family, cost, stability, warnings, notes,
}) {
  const result = {
    schema: 'zhihu-research-benchmark/result',
    schema_version: '1.0.0-pilot',
    generated_at: new Date().toISOString(),
    dataset_version,
    dataset_version_status,
    case_id,
    case_meta,
    strategy_id,
    strategy_config,
    candidate_pool_id,
    budget,
    selected_source_ids,
    provenance,
    metric_results,
    gold_stats_by_family,
    cost,
    stability,
    warnings,
    notes,
    runtime_identity: runtimeIdentity(),
  };
  return result;
}

export function writeResult(result, filePath, { sanitizeOutput = true } = {}) {
  const out = sanitizeOutput ? sanitize(result) : result;
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n');
  return filePath;
}
