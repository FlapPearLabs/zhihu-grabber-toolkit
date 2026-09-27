#!/usr/bin/env node
/**
 * validate-codebuddy-bootstrap.mjs — deterministic delivery-contract validator
 * for the WorkBuddy first-turn bootstrap pointer (CODEBUDDY.md).
 *
 * WHY THIS EXISTS
 * ---------------
 * WorkBuddy injects, on the first turn only, the FIRST EXISTING file of
 *
 *     GUIDANCE_FILES = ["CODEBUDDY.md", ".codebuddy/CODEBUDDY.md", "AGENTS.md"]
 *
 * truncated to MAX_GUIDANCE_CHARS. RULES.md is not in that list at all.
 * Observed on WorkBuddy 5.5.3 (app.asar sha256 f9a3803e..., 2026-09-04):
 *
 *     MAX_GUIDANCE_CHARS = 8e3        // 8000
 *     raw.length > MAX ? raw.slice(0, MAX) + "[...too long, omitted...]" : raw
 *
 * `raw.length` is a JavaScript string length. This validator therefore measures
 * with String.prototype.length as well — NOT with UTF-8 byte length. The two are
 * not interchangeable, and silently substituting one for the other would make
 * this validator assert something the runtime never does.
 *
 * SCOPE
 * -----
 * This validator checks the DELIVERY contract of CODEBUDDY.md only. It does not
 * and cannot verify that the runtime actually selected the file, that the agent
 * subsequently read the full authority set, or that any gate was enforced.
 *
 *     DELIVERY_CONTRACT_VALID  !=  BOOTSTRAP_ACTUALLY_HAPPENED
 *     FILE_EXISTS_IN_REPO      !=  CONSUMED_AT_RUNTIME
 *
 * Exit 0 = all checks PASS. Exit 1 = at least one FAIL. Stdlib only, no network.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Observed WorkBuddy runtime truncation point. Profile/version observation, not a universal constant. */
const RUNTIME_MAX_GUIDANCE_CHARS = 8000;
/** Repository-side safety target. Deliberately below the observed runtime cap. */
const REPO_SAFE_LIMIT_CHARS = 7000;
/** Soft budget: exceeding this is reported but is not a failure. */
const REPO_SOFT_BUDGET_CHARS = 6000;

const CODEBUDDY_PATH = join(REPO_ROOT, "CODEBUDDY.md");

/** Authority pointers the bootstrap must name. Each entry is [label, regex]. */
const REQUIRED_AUTHORITY_POINTERS = [
  ["RULES.md", /RULES\.md/],
  ["AGENTS.md", /AGENTS\.md/],
  ["docs/project-memory.md", /docs\/project-memory\.md/],
  ["Applicable Approved Specs", /Approved Specs/i],
  ["product-behavior-contract.md", /docs\/product-behavior-contract\.md/],
  ["Issue / Tracker / Ticket Graph", /(Issue|Tracker|Ticket Graph)/],
  ["remote truth step", /ls-remote|remote truth/i],
];

/** The bootstrap is not allowed to become a second AGENTS.md. */
const FORBIDDEN_AGENTS_SECTION_MARKERS = [
  { id: "agents-execution-workflow", re: /^#{1,3}\s*1?8?\.?\s*(Contract-Driven Code Execution|FROZEN AUTHORITY)/im },
  { id: "agents-review-quorum", re: /Review Quorum|Universal PASS Contract/i },
  { id: "agents-exact-sha-merge", re: /Exact-SHA Review|ff-only merge/i },
  { id: "agents-branch-workflow-blocks", re: /ONE_ACTIVE_WRITER_PER_BRANCH|MASTER_DRIFT/i },
  { id: "agents-stop-enum", re: /USER_DECISION_REQUIRED|CONTRACT_CONFLICT\s*$/im },
];

/** The bootstrap must stay a pointer: no permission grants, no auto-mode changes. */
const FORBIDDEN_AUTHORITY_GRANTS = [
  { id: "permission-mode-flip", re: /bypassPermissions|acceptEdits|--dangerously-skip-permissions/i },
  { id: "permission-rule-syntax", re: /"permissions"\s*:|permissions\s*\.\s*(allow|deny)\s*\[/i },
  { id: "gate-waiver", re: /(skip|bypass|waive|豁免|跳过)\s*(the\s*)?(independent\s*)?(review|gate|审查|评审)/i },
  { id: "self-authorization", re: /already\s+authorized|预先授权|无需确认即可/i },
  { id: "non-override-absent", re: /^\s*$/ },
];

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: Boolean(ok), detail });
}

function fail(id, detail) {
  check(id, false, detail);
}

function pass(id, detail) {
  check(id, true, detail);
}

function main() {
  if (!existsSync(CODEBUDDY_PATH)) {
    fail("file-exists", `CODEBUDDY.md not found at repo root: ${CODEBUDDY_PATH}`);
    report();
    return;
  }
  const raw = readFileSync(CODEBUDDY_PATH, "utf8");

  // --- size contract (JS string length == runtime semantics) -----------------
  const len = raw.length;

  if (len <= REPO_SAFE_LIMIT_CHARS) {
    pass(
      "size-vs-safe-limit",
      `length=${len} chars <= REPO_SAFE_LIMIT_CHARS=${REPO_SAFE_LIMIT_CHARS} (runtime cap=${RUNTIME_MAX_GUIDANCE_CHARS})`,
    );
  } else {
    fail(
      "size-vs-safe-limit",
      `length=${len} chars EXCEEDS REPO_SAFE_LIMIT_CHARS=${REPO_SAFE_LIMIT_CHARS}. ` +
        `The file will be silently truncated by the runtime at ${RUNTIME_MAX_GUIDANCE_CHARS} chars.`,
    );
  }

  if (len >= RUNTIME_MAX_GUIDANCE_CHARS) {
    fail(
      "size-vs-runtime-cap",
      `length=${len} chars >= observed runtime cap ${RUNTIME_MAX_GUIDANCE_CHARS}: the tail is guaranteed to be dropped.`,
    );
  } else {
    pass("size-vs-runtime-cap", `length=${len} chars < ${RUNTIME_MAX_GUIDANCE_CHARS} (no truncation)`);
  }

  if (len > REPO_SOFT_BUDGET_CHARS) {
    // not a failure — recorded so growth is visible in CI output
    console.log(
      `[warn] CODEBUDDY.md is ${len} chars (> soft budget ${REPO_SOFT_BUDGET_CHARS}). ` +
        `Still within the safe limit; keep it a pointer, not a manual.`,
    );
  }

  // --- required authority pointers -------------------------------------------
  const missing = REQUIRED_AUTHORITY_POINTERS.filter(([, re]) => !re.test(raw)).map(([label]) => label);
  if (missing.length === 0) {
    pass("authority-pointers-present", `${REQUIRED_AUTHORITY_POINTERS.length} pointers found`);
  } else {
    fail("authority-pointers-present", `missing authority pointers: ${missing.join(", ")}`);
  }

  // --- must not grow into a second AGENTS.md ----------------------------------
  const grown = FORBIDDEN_AGENTS_SECTION_MARKERS.filter(({ re }) => re.test(raw)).map(({ id }) => id);
  if (grown.length === 0) {
    pass("not-a-second-agents-md", "no AGENTS.md section bodies detected");
  } else {
    fail(
      "not-a-second-agents-md",
      `CODEBUDDY.md has started to inline AGENTS.md content: ${grown.join(", ")}. ` +
        `The bootstrap must POINT, not COPY.`,
    );
  }

  // --- must not grant authority -----------------------------------------------
  const granting = FORBIDDEN_AUTHORITY_GRANTS.filter(({ id, re }) => id !== "non-override-absent" && re.test(raw)).map(
    ({ id }) => id,
  );
  if (granting.length === 0) {
    pass("no-authority-grant", "no permission grants / gate waivers detected");
  } else {
    fail(
      "no-authority-grant",
      `bootstrap contains behavior-changing text: ${granting.join(", ")}. ` +
        `A bootstrap pointer must not grant permissions or waive gates.`,
    );
  }

  // --- explicit non-override statement ----------------------------------------
  const hasNonOverride =
    /不覆盖|does not override|not override/i.test(raw) &&
    /RULES\.md/.test(raw) &&
    /AGENTS\.md/.test(raw);
  if (hasNonOverride) {
    pass("non-override-declared", "explicit non-override statement for RULES.md / AGENTS.md present");
  } else {
    fail("non-override-declared", "missing explicit statement that CODEBUDDY.md does not override RULES.md / AGENTS.md");
  }

  // --- bootstrap receipt required ---------------------------------------------
  const receiptFields = [
    "BOOTSTRAP_RECEIPT",
    "REMOTE_MASTER",
    "AGENTS_FULL_READ",
    "RULES_FULL_READ",
    "PROJECT_MEMORY_READ",
    "NEXT_LEGAL_ACTION",
  ];
  const missingReceipt = receiptFields.filter((f) => !raw.includes(f));
  if (missingReceipt.length === 0) {
    pass("bootstrap-receipt-schema", "receipt schema complete");
  } else {
    fail("bootstrap-receipt-schema", `receipt schema missing fields: ${missingReceipt.join(", ")}`);
  }

  report();
}

function report() {
  const failed = results.filter((r) => !r.ok);
  console.log("CODEBUDDY.md bootstrap delivery contract");
  console.log(`  file: ${CODEBUDDY_PATH}`);
  console.log("  checks:");
  for (const r of results) {
    console.log(`    ${r.ok ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  }
  console.log("");
  if (failed.length === 0) {
    console.log(`RESULT: PASS (${results.length}/${results.length} checks)`);
    process.exit(0);
  }
  console.log(`RESULT: FAIL (${failed.length}/${results.length} checks failed)`);
  process.exit(1);
}

main();
