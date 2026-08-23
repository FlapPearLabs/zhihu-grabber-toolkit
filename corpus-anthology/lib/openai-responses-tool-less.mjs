const RUNTIME_ID = 'openai-responses-tool-less';
const MODEL_ID = 'gpt-4.1-2025-04-14';
const ENDPOINT = 'https://api.openai.com/v1/responses';

export const REVIEWED_RUNTIME = Object.freeze({
  runtimeId: RUNTIME_ID,
  endpoint: ENDPOINT,
  model: MODEL_ID,
  tools: Object.freeze([]),
  toolChoice: 'none',
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const MAP_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'claims', 'sourceCoverage'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidenceSourceIds', 'confidence'],
        properties: {
          claim: { type: 'string', minLength: 1 },
          evidenceSourceIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    sourceCoverage: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'summary'],
        properties: {
          sourceId: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
        },
      },
    },
  },
});

function fail(message) {
  throw new Error(`capability_isolation_unavailable: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const SOURCE_TAG = /^\[SOURCE ([A-Za-z0-9][A-Za-z0-9._-]{0,127})\]$/;

function isValidSourceId(sourceId) {
  return typeof sourceId === 'string' && SOURCE_TAG.test(`[SOURCE ${sourceId}]`);
}

function assertSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds)
    || sourceIds.length === 0
    || sourceIds.some((sourceId) => !isValidSourceId(sourceId))
    || new Set(sourceIds).size !== sourceIds.length) {
    fail('source IDs must be non-empty, unique, and use the restricted source-ID grammar');
  }
}

function normalizePercentEncoding(text) {
  let normalized = text;
  for (let pass = 0; pass < 8; pass += 1) {
    if (!normalized.includes('%')) return normalized;
    let decoded;
    try {
      decoded = decodeURIComponent(normalized);
    } catch {
      fail('projection contains invalid or ambiguous percent encoding');
    }
    if (decoded === normalized) return normalized;
    normalized = decoded;
  }
  if (!normalized.includes('%')) return normalized;
  fail('projection contains percent encoding nested too deeply to verify safely');
}

function hasRemoteOrFileReference(text) {
  if (/[\p{Cf}\p{Cs}]/u.test(text)
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)) {
    return true;
  }
  const normalized = normalizePercentEncoding(text);
  return /(?:^|[^A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized)
    || /(?:\/\/|\\\\|\bwww\.)/iu.test(normalized)
    || /(?:^|[\s<("'])\/(?:[A-Za-z0-9._~-]+(?:\/|$))/u.test(normalized)
    || /(?:^|\s)(?:\.\.?[\\/])/u.test(normalized)
    || /[\p{Cf}\p{Cs}]/u.test(normalized)
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(normalized);
}

function assertSourceTagContract(text, sourceIds) {
  const sourceTags = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.includes('[SOURCE')) {
      const match = SOURCE_TAG.exec(line);
      if (!match) fail('projection contains an ambiguous source tag');
      sourceTags.push(match[1]);
    }
  }
  if (!sameStringArray(sourceTags, sourceIds)) {
    fail('projection source tags must exactly and once match declared source IDs');
  }
}

export function assertReviewedRuntime(runtime = REVIEWED_RUNTIME) {
  if (!isPlainObject(runtime)
    || !hasExactKeys(runtime, ['runtimeId', 'endpoint', 'model', 'tools', 'toolChoice'])
    || runtime.runtimeId !== RUNTIME_ID
    || runtime.endpoint !== ENDPOINT
    || runtime.model !== MODEL_ID
    || !sameStringArray(runtime.tools, [])
    || runtime.toolChoice !== 'none') {
    fail('runtime configuration does not exactly match the reviewed tool-less runtime');
  }
}

export function buildToolLessResponseRequest({ projection, runtime = REVIEWED_RUNTIME }) {
  assertReviewedRuntime(runtime);
  if (!isPlainObject(projection)
    || !hasExactKeys(projection, ['kind', 'text', 'sourceIds'])
    || projection.kind !== 'deterministic-analysis-projection'
    || typeof projection.text !== 'string'
    || projection.text.trim() === '') {
    fail('projection must be non-empty deterministic text with explicit source IDs');
  }
  assertSourceIds(projection.sourceIds);
  if (hasRemoteOrFileReference(projection.text)) {
    fail('projection contains a remote or file reference');
  }
  assertSourceTagContract(projection.text, projection.sourceIds);

  return {
    model: MODEL_ID,
    input: projection.text,
    tools: [],
    tool_choice: 'none',
    parallel_tool_calls: false,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'tool_less_map_result',
        strict: true,
        schema: MAP_SCHEMA,
      },
    },
  };
}

function validateMap(map, sourceIds) {
  if (!isPlainObject(map)
    || map.schemaVersion !== 1
    || !Array.isArray(map.claims)
    || !Array.isArray(map.sourceCoverage)
    || Object.keys(map).some((key) => !['schemaVersion', 'claims', 'sourceCoverage'].includes(key))) {
    fail('structured output does not match the qualification map schema');
  }

  const expected = new Set(sourceIds);
  for (const claim of map.claims) {
    if (!isPlainObject(claim)
      || !hasExactKeys(claim, ['claim', 'evidenceSourceIds', 'confidence'])
      || typeof claim.claim !== 'string'
      || claim.claim.trim() === ''
      || !['high', 'medium', 'low'].includes(claim.confidence)
      || !Array.isArray(claim.evidenceSourceIds)
      || claim.evidenceSourceIds.length === 0
      || claim.evidenceSourceIds.some((sourceId) => !expected.has(sourceId))) {
      fail('claim has invalid source/evidence IDs or schema');
    }
  }

  const covered = new Set();
  for (const entry of map.sourceCoverage) {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, ['sourceId', 'summary'])
      || typeof entry.sourceId !== 'string'
      || !expected.has(entry.sourceId)
      || covered.has(entry.sourceId)
      || typeof entry.summary !== 'string'
      || entry.summary.trim() === '') {
      fail('sourceCoverage has invalid source IDs or schema');
    }
    covered.add(entry.sourceId);
  }
  if (covered.size !== expected.size || [...expected].some((sourceId) => !covered.has(sourceId))) {
    fail('sourceCoverage does not cover every supplied source ID');
  }
  return map;
}

export function validateToolLessResponse(response, { sourceIds, runtime = REVIEWED_RUNTIME }) {
  assertReviewedRuntime(runtime);
  assertSourceIds(sourceIds);
  if (!isPlainObject(response)
    || !hasExactKeys(response, ['status', 'model', 'tools', 'tool_choice', 'output'])
    || response.status !== 'completed'
    || response.model !== MODEL_ID
    || !sameStringArray(response.tools, [])
    || response.tool_choice !== 'none'
    || !Array.isArray(response.output)
    || response.output.length !== 1) {
    fail('response runtime identity, tool configuration, status, or output item count is invalid');
  }

  const [message] = response.output;
  if (!isPlainObject(message)
    || !hasExactKeys(message, ['type', 'role', 'status', 'content'])
    || message.type !== 'message'
    || message.role !== 'assistant'
    || message.status !== 'completed'
    || !Array.isArray(message.content)
    || message.content.length !== 1
    || !isPlainObject(message.content[0])
    || !hasExactKeys(message.content[0], ['type', 'text'])
    || message.content[0].type !== 'output_text'
    || typeof message.content[0].text !== 'string') {
    fail('response contains an unsupported output item');
  }

  let parsed;
  try {
    parsed = JSON.parse(message.content[0].text);
  } catch {
    fail('structured output is not valid JSON');
  }
  return validateMap(parsed, sourceIds);
}

export async function runToolLessMap({ projection, apiKey, runtime = REVIEWED_RUNTIME, fetchImpl = fetch }) {
  const request = buildToolLessResponseRequest({ projection, runtime });
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    fail('controller has no API credential for runtime verification');
  }
  if (typeof fetchImpl !== 'function') fail('controller has no HTTPS transport');

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response || response.ok !== true) {
    fail(`Responses API request failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('Responses API returned non-JSON data');
  }
  return validateToolLessResponse(payload, { sourceIds: projection.sourceIds, runtime });
}
