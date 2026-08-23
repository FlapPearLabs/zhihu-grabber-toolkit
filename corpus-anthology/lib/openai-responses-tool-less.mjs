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

const MAP_SCHEMA = Object.freeze({
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

function hasRemoteOrFileReference(text) {
  return /(?:https?:\/\/|\bwww\.|\bfile:|\bdata:|\bblob:)/i.test(text);
}

export function assertReviewedRuntime(runtime = REVIEWED_RUNTIME) {
  if (!isPlainObject(runtime)
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
    || projection.kind !== 'deterministic-analysis-projection'
    || typeof projection.text !== 'string'
    || projection.text.trim() === ''
    || !Array.isArray(projection.sourceIds)
    || projection.sourceIds.length === 0
    || projection.sourceIds.some((sourceId) => typeof sourceId !== 'string' || sourceId.trim() === '')
    || new Set(projection.sourceIds).size !== projection.sourceIds.length) {
    fail('projection must be non-empty deterministic text with explicit source IDs');
  }
  if (hasRemoteOrFileReference(projection.text)) {
    fail('projection contains a remote or file reference');
  }

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
  if (!isPlainObject(response)
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
    || message.type !== 'message'
    || message.role !== 'assistant'
    || message.status !== 'completed'
    || !Array.isArray(message.content)
    || message.content.length !== 1
    || !isPlainObject(message.content[0])
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
