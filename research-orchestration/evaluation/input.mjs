// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeQueryString } from '../lib/targeted-requery-authorization.mjs';
import { validatePlanInput } from '../lib/plan-contract.mjs';

const reject = () => { throw new Error('BENCHMARK_CONTAMINATION_OR_INVALID_INPUT'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (value, keys) => object(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

/** Closed product input: evaluator labels and target definitions have no slot. */
export function validateProductInput(input) {
  if (!exactKeys(input, ['schema_version', 'case_id', 'task', 'time_scope', 'plan', 'corpus', 'routes'])
      || input.schema_version !== 1 || ![input.case_id, input.task, input.time_scope].every(text)
      || input.task.trim().length > 2000
      || !validatePlanInput(input.plan).ok || !Array.isArray(input.corpus) || !input.corpus.length
      || !object(input.routes)) reject();
  const ids = new Set();
  for (const source of input.corpus) {
    if (!exactKeys(source, ['question_id', 'title', 'text'])
        || !/^[1-9]\d*$/.test(source.question_id) || ids.has(source.question_id)
        || !text(source.title) || !text(source.text)) reject();
    ids.add(source.question_id);
  }
  const normalizedQueries = new Set();
  for (const [query, routes] of Object.entries(input.routes)) {
    const normalized = normalizeQueryString(query);
    if (!text(query) || normalizedQueries.has(normalized) || !Array.isArray(routes) || routes.some(id => typeof id !== 'string' || !ids.has(id))) reject();
    normalizedQueries.add(normalized);
  }
  return input;
}
