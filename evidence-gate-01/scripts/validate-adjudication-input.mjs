// validate-adjudication-input.mjs — §2 SECOND_ADJUDICATION_INPUT_VALIDATION.
// FAIL CLOSED. Validates the ChatGPT adjudication file against the original
// blinded packet BEFORE any application:
//   V1 47/47 label_id exist in the packet, none unknown, none missing
//   V2 decisions are only YES / NO / UNSURE
//   V3 no source identity modification (source_id must match packet exactly)
//   V4 no strategy identity appears in judgments
//   V5 unblinding key covers all 47 packet sources (1:1)
//   V6 packet blinding intact (no votes/strategy in packet)

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../lib/paths.mjs';

const PACKET = path.join(paths.root, 'adjudication/decision-sensitive-packet.json');
const KEY = path.join(paths.root, 'adjudication/decision-sensitive-key.json');
const CHATGPT = process.env.CHATGPT_ADJUDICATION || path.join(paths.root, 'adjudication/CHATGPT_SECOND_ADJUDICATION_GATE01_V1.json');

const failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(`${name}: ${detail}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

function load(p) {
  if (!fs.existsSync(p)) { console.error(`MISSING ${p}`); process.exit(2); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const packet = load(PACKET);
const key = load(KEY);

check('V5 unblinding key covers all packet sources (47/47)', packet.labels.length === 47 && packet.labels.every((l) => key[l.source_id]), `packet=${packet.labels.length} uncovered=${packet.labels.filter((l) => !key[l.source_id]).length}`);

if (!fs.existsSync(CHATGPT)) {
  console.log(`ADJUDICATION_FILE_MISSING: ${CHATGPT}`);
  process.exit(2);
}
const adj = load(CHATGPT);

// decisions may be a list of {label_id, decision} or a label_id->decision map
const byLabel = new Map();
for (const l of packet.labels) byLabel.set(l.label_id, l);
const decisions = new Map();
const raw = adj.decisions || adj;
if (Array.isArray(raw)) {
  for (const item of raw) {
    if (item && item.label_id != null) decisions.set(item.label_id, item.decision);
    else if (item && typeof item === 'object') {
      const [k, v] = Object.entries(item)[0];
      decisions.set(k, v);
    }
  }
} else {
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'object' && v !== null && v.decision !== undefined) decisions.set(k, v.decision);
    else decisions.set(k, v);
  }
}

// V1: coverage
{
  const known = new Set(packet.labels.map((l) => l.label_id));
  const unknown = [...decisions.keys()].filter((k) => !known.has(k));
  const missing = packet.labels.filter((l) => !decisions.has(l.label_id)).map((l) => l.label_id);
  check(`V1 label coverage: 47/47, no unknown (unknown=${unknown.length}, missing=${missing.length})`, unknown.length === 0 && missing.length === 0, `unknown=[${unknown.slice(0, 5)}] missing=[${missing.slice(0, 5)}]`);
}

// V2: decision values
{
  const bad = [...decisions.entries()].filter(([, v]) => !['YES', 'NO', 'UNSURE'].includes(String(v).toUpperCase()));
  check(`V2 decisions only YES/NO/UNSURE (bad=${bad.length})`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));
}

// V3: source identity unchanged (decisions keyed by packet label/source ids)
{
  const srcs = new Set(packet.labels.map((l) => l.source_id));
  const keySrcs = Object.keys(Object.fromEntries(decisions.entries().map(([k]) => [k.replace(/^(MS|MS2|ST|ASP):/, ''), true])));
  const touch = new Set();
  for (const k of decisions.keys()) {
    const suspect = k.replace(/^(MS|MS2|ST|ASP):/, '').split(':').slice(0, 2).join(':');
    // best-effort: any decision key must resolve inside packet label space
    const hit = packet.labels.some((l) => l.label_id === k || l.source_id === k);
    if (hit) touch.add(k);
  }
  check('V3 source identity unchanged (all decision keys resolve to packet labels/sources)', touch.size === decisions.size, `unresolved=${[...decisions.keys()].filter((k) => !touch.has(k)).slice(0, 5)}`);
}

// V4: no strategy identity in adjudication values
{
  const txt = JSON.stringify(adj);
  const leaked = /B0_|B1_|B2_|B3_|POPULARITY|MMR|ORACLE|stratified/i.test(txt);
  check('V4 no strategy identity in adjudication file', !leaked, 'strategy tokens found');
}

// V6: packet blinding intact
{
  const pkt = JSON.stringify(packet);
  check('V6 packet blind (no votes/strategy tokens)', !/voteup|commentCount|B3_ORACLE|B0_POPULARITY/.test(pkt));
}

console.log(failures.length ? `\nSECOND_ADJUDICATION_INPUT_VALIDATION_FAILED (${failures.length})` : '\nSECOND_ADJUDICATION_INPUT_VALIDATION = PASS');
process.exit(failures.length ? 1 : 0);