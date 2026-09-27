#!/usr/bin/env node
/**
 * kanban-status-transition.mjs — deterministic Status transition applier for the
 * Zhihu Engineering Control Board (GitHub Projects V2).
 *
 * WHY THIS EXISTS
 * ---------------
 * The control plane is a VIEW over Issue / Ticket Graph authority. Moving a card
 * must therefore be a mechanical, auditable act — never a judgement call. Doing it
 * by hand invites three failure modes: transposing two cards, advancing a card past
 * a gate that has not actually passed, and silently writing `AUTHORIZED` to make the
 * board look tidy.
 *
 * This script removes the first two and structurally cannot do the third:
 *
 *     CALLER SUPPLIES  =  (issue number, lifecycle event)
 *     SCRIPT DERIVES   =  the one legal target Status for that event
 *     SCRIPT WRITES    =  the Status field, and nothing else
 *
 * AUTHORITY BOUNDARY
 * ------------------
 * This script does NOT decide authorization, does NOT touch the Issue, does NOT
 * change dependencies or the DAG, does NOT infer architecture, and does NOT create
 * branches, worktrees or implementations. It never writes any field other than
 * Status. The event is an INPUT — the caller must already hold real evidence that
 * the event actually occurred.
 *
 *     TRANSITION_APPLIED       !=  GATE_PASSED
 *     CARD_SAYS_AUTHORIZED     !=  AUTHORIZATION_GRANTED
 *     SELF_TEST_PASS           !=  PROJECT_IO_VERIFIED
 *
 * MODES
 * -----
 *   --self-test   Validate the closed mapping table and its reachability closure.
 *                 Fully offline: no network, no credentials, no `gh` invocation.
 *   --dry-run     Resolve project/item/current Status and print the intended
 *                 mutation. No write.
 *   (default)     Apply, then RE-READ and verify the observed value.
 *
 * EXIT CODES
 * ----------
 *   0  applied, or an idempotent NOOP (target == current)
 *   1  contract violation: unknown event, illegal transition, bad arguments
 *   2  environment failure: gh missing, missing read:project / project scope,
 *      project or item not found
 *
 * Contract: docs/kanban-control-plane-contract.md. Stdlib only.
 */

import { spawnSync } from "node:child_process";

const EXIT_OK = 0;
const EXIT_CONTRACT = 1;
const EXIT_ENVIRONMENT = 2;

/** Closed Status vocabulary. Exactly the eight values of the contract; no others. */
const STATUSES = Object.freeze([
  "BACKLOG",
  "READY",
  "AUTHORIZED",
  "IN PROGRESS",
  "REVIEW",
  "INTEGRATING / CI",
  "BLOCKED",
  "DONE",
]);

/** Terminal Status. No transition may leave it. */
const TERMINAL = "DONE";

/**
 * Closed transition table. Any (event, current) pair absent from `from` is refused;
 * the script never picks a "nearest" legal state.
 */
const TRANSITIONS = Object.freeze([
  Object.freeze({
    event: "DEPENDENCY_RECOMPUTED_READY",
    to: "READY",
    from: Object.freeze(["BACKLOG", "BLOCKED"]),
  }),
  Object.freeze({
    event: "START_GATE_PASS",
    to: "AUTHORIZED",
    from: Object.freeze(["READY", "BLOCKED"]),
  }),
  Object.freeze({
    event: "IMPLEMENTATION_LANE_CREATED",
    to: "IN PROGRESS",
    from: Object.freeze(["AUTHORIZED"]),
  }),
  Object.freeze({
    event: "REMOTE_CANDIDATE_PUSHED",
    to: "REVIEW",
    from: Object.freeze(["IN PROGRESS"]),
  }),
  Object.freeze({
    event: "EXACT_SHA_QUORUM_PASS",
    to: "INTEGRATING / CI",
    from: Object.freeze(["REVIEW"]),
  }),
  Object.freeze({
    event: "INTEGRATION_COMPLETE",
    to: "DONE",
    from: Object.freeze(["INTEGRATING / CI"]),
  }),
  Object.freeze({
    event: "BLOCKER_DISCOVERED",
    to: "BLOCKED",
    from: Object.freeze([
      "BACKLOG",
      "READY",
      "AUTHORIZED",
      "IN PROGRESS",
      "REVIEW",
      "INTEGRATING / CI",
    ]),
  }),
]);

const EVENT_NAMES = Object.freeze(TRANSITIONS.map((t) => t.event));

/**
 * Resolve one mechanical transition. Pure: no IO, no clock, no randomness.
 *
 * @returns {{kind:'APPLY', to:string, event:string}
 *          |{kind:'NOOP', status:string, event:string}
 *          |{kind:'REFUSE', reason:string, event:string, current:string|null}}
 */
function resolveTransition(event, current) {
  if (typeof event !== "string" || !EVENT_NAMES.includes(event)) {
    return { kind: "REFUSE", reason: "UNKNOWN_EVENT", event: String(event), current };
  }
  const rule = TRANSITIONS.find((t) => t.event === event);
  if (typeof current !== "string" || !STATUSES.includes(current)) {
    return { kind: "REFUSE", reason: "UNKNOWN_CURRENT_STATUS", event, current };
  }
  if (current === rule.to) {
    return { kind: "NOOP", status: rule.to, event };
  }
  if (current === TERMINAL) {
    return { kind: "REFUSE", reason: "TERMINAL_STATUS_HAS_NO_OUT_EDGE", event, current };
  }
  if (!rule.from.includes(current)) {
    return { kind: "REFUSE", reason: "ILLEGAL_TRANSITION", event, current };
  }
  return { kind: "APPLY", to: rule.to, event };
}

// ---------------------------------------------------------------------------
// self-test (offline)
// ---------------------------------------------------------------------------

function selfTest() {
  const results = [];
  const check = (id, ok, detail) => results.push({ id, ok, detail });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const requiredEvents = [
    "DEPENDENCY_RECOMPUTED_READY",
    "START_GATE_PASS",
    "IMPLEMENTATION_LANE_CREATED",
    "REMOTE_CANDIDATE_PUSHED",
    "EXACT_SHA_QUORUM_PASS",
    "INTEGRATION_COMPLETE",
    "BLOCKER_DISCOVERED",
  ];
  check(
    "event-set-closed",
    eq(EVENT_NAMES, requiredEvents),
    `events = ${EVENT_NAMES.join(", ")}`,
  );

  const badTarget = TRANSITIONS.filter((t) => !STATUSES.includes(t.to));
  check(
    "targets-in-vocabulary",
    badTarget.length === 0,
    badTarget.length === 0
      ? "every target Status is in the closed vocabulary"
      : `out-of-vocabulary targets: ${badTarget.map((t) => t.to).join(", ")}`,
  );

  const badFrom = TRANSITIONS.flatMap((t) =>
    t.from.filter((s) => !STATUSES.includes(s)).map((s) => `${t.event}<-${s}`),
  );
  check(
    "preconditions-in-vocabulary",
    badFrom.length === 0,
    badFrom.length === 0
      ? "every precondition Status is in the closed vocabulary"
      : `out-of-vocabulary preconditions: ${badFrom.join(", ")}`,
  );

  check(
    "no-out-edge-from-done",
    TRANSITIONS.every((t) => !t.from.includes(TERMINAL)),
    "DONE appears in no precondition set",
  );

  const chain = [
    ["DEPENDENCY_RECOMPUTED_READY", "BACKLOG", "READY"],
    ["START_GATE_PASS", "READY", "AUTHORIZED"],
    ["IMPLEMENTATION_LANE_CREATED", "AUTHORIZED", "IN PROGRESS"],
    ["REMOTE_CANDIDATE_PUSHED", "IN PROGRESS", "REVIEW"],
    ["EXACT_SHA_QUORUM_PASS", "REVIEW", "INTEGRATING / CI"],
    ["INTEGRATION_COMPLETE", "INTEGRATING / CI", "DONE"],
  ];
  const chainFailures = chain.filter(([event, from, to]) => {
    const r = resolveTransition(event, from);
    return r.kind !== "APPLY" || r.to !== to;
  });
  check(
    "forward-chain-reachable",
    chainFailures.length === 0,
    chainFailures.length === 0
      ? "BACKLOG -> READY -> AUTHORIZED -> IN PROGRESS -> REVIEW -> INTEGRATING / CI -> DONE"
      : `unreachable steps: ${chainFailures.map((c) => c[0]).join(", ")}`,
  );

  const idempotent = EVENT_NAMES.every((event) => {
    const to = TRANSITIONS.find((t) => t.event === event).to;
    return resolveTransition(event, to).kind === "NOOP";
  });
  check("idempotent-replay", idempotent, "replaying an event whose target is current yields NOOP");

  // DONE is terminal: the invariant is that no event may MOVE a card out of DONE.
  // An event whose own target is already DONE (INTEGRATION_COMPLETE) must stay an
  // idempotent NOOP rather than being refused — replaying it is legal and harmless.
  const doneExits = EVENT_NAMES.filter(
    (event) => resolveTransition(event, TERMINAL).kind === "APPLY",
  );
  check(
    "done-has-no-exit",
    doneExits.length === 0,
    doneExits.length === 0
      ? "no event moves a card out of DONE"
      : `events wrongly moving a card out of DONE: ${doneExits.join(", ")}`,
  );

  check(
    "done-replay-is-noop",
    resolveTransition("INTEGRATION_COMPLETE", TERMINAL).kind === "NOOP",
    "INTEGRATION_COMPLETE replayed on a DONE card is an idempotent NOOP",
  );

  const skipChecks = [
    ["START_GATE_PASS", "BACKLOG"],
    ["IMPLEMENTATION_LANE_CREATED", "READY"],
    ["REMOTE_CANDIDATE_PUSHED", "AUTHORIZED"],
    ["INTEGRATION_COMPLETE", "REVIEW"],
    ["IMPLEMENTATION_LANE_CREATED", "BLOCKED"],
  ];
  const skipFailures = skipChecks.filter(
    ([event, from]) => resolveTransition(event, from).kind !== "REFUSE",
  );
  check(
    "gate-skipping-refused",
    skipFailures.length === 0,
    skipFailures.length === 0
      ? "5 gate-skipping attempts refused (no nearest-state fallback)"
      : `wrongly allowed: ${skipFailures.map((s) => s.join("@")).join(", ")}`,
  );

  const unknown = resolveTransition("NOT_AN_EVENT", "READY");
  check(
    "unknown-event-refused",
    unknown.kind === "REFUSE" && unknown.reason === "UNKNOWN_EVENT",
    "an unlisted event is refused, not guessed",
  );

  const unknownStatus = resolveTransition("START_GATE_PASS", "ALMOST_DONE");
  check(
    "unknown-status-refused",
    unknownStatus.kind === "REFUSE" && unknownStatus.reason === "UNKNOWN_CURRENT_STATUS",
    "an out-of-vocabulary current Status is refused",
  );

  // A blocker may be discovered from any live state. The one legitimate non-APPLY
  // outcome is when the card is already BLOCKED — that replay must be a NOOP, not a
  // refusal, so that idempotent re-runs after a partial failure stay safe.
  const blockerOutcomes = STATUSES.filter((s) => s !== TERMINAL).map((s) => [
    s,
    resolveTransition("BLOCKER_DISCOVERED", s).kind,
  ]);
  const blockerWrong = blockerOutcomes.filter(
    ([s, kind]) => !(kind === "APPLY" || (s === "BLOCKED" && kind === "NOOP")),
  );
  check(
    "blocker-reachable-from-any-live-state",
    blockerWrong.length === 0,
    blockerWrong.length === 0
      ? "BLOCKER_DISCOVERED applies from every non-terminal Status (NOOP when already BLOCKED)"
      : `unexpected outcomes: ${blockerWrong.map((b) => b.join("@")).join(", ")}`,
  );

  check(
    "vocabulary-fidelity",
    STATUSES.includes("INTEGRATING / CI") && STATUSES.length === 8,
    "8 Statuses; slash-and-space form 'INTEGRATING / CI' preserved verbatim",
  );

  const failed = results.filter((r) => !r.ok);
  console.log("kanban Status transition contract");
  console.log("  checks:");
  for (const r of results) {
    console.log(`    ${r.ok ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  }
  console.log("");
  if (failed.length === 0) {
    console.log(`RESULT: PASS (${results.length}/${results.length} checks)`);
    console.log("NOTE: this validates the mapping table only. It does not touch GitHub,");
    console.log("      and does not verify any project I/O path.");
    process.exit(EXIT_OK);
  }
  console.log(`RESULT: FAIL (${failed.length}/${results.length} checks failed)`);
  process.exit(EXIT_CONTRACT);
}

// ---------------------------------------------------------------------------
// gh / GraphQL plumbing
// ---------------------------------------------------------------------------

function ghGraphql(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const res = spawnSync("gh", args, { encoding: "utf8" });
  if (res.error) {
    return { ok: false, envFailure: true, message: `cannot run gh: ${res.error.message}` };
  }
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  if (res.status !== 0) {
    if (/missing required scopes|INSUFFICIENT_SCOPES/i.test(`${stdout}${stderr}`)) {
      return {
        ok: false,
        envFailure: true,
        message:
          "token lacks Project scopes. Run: gh auth refresh -s project,read:project",
      };
    }
    return { ok: false, envFailure: true, message: stderr.trim() || stdout.trim() };
  }
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.errors && parsed.errors.length > 0) {
      const msgs = parsed.errors.map((e) => `${e.type || "ERROR"}: ${e.message}`).join("; ");
      const envFailure = parsed.errors.some((e) => e.type === "INSUFFICIENT_SCOPES");
      return { ok: false, envFailure, message: msgs };
    }
    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, envFailure: true, message: `unparsable gh output: ${err.message}` };
  }
}

const PROJECT_BY_NUMBER = `
query($login:String!,$number:Int!){
  organization(login:$login){ projectV2(number:$number){ id number title url } }
  user(login:$login){ projectV2(number:$number){ id number title url } }
}`;

const PROJECT_BY_TITLE = `
query($login:String!){
  organization(login:$login){ projectsV2(first:100){ nodes{ id number title url } } }
  user(login:$login){ projectsV2(first:100){ nodes{ id number title url } } }
}`;

const STATUS_FIELD = `
query($projectId:ID!){
  node(id:$projectId){
    ... on ProjectV2{
      fields(first:50){
        nodes{
          ... on ProjectV2SingleSelectField{ id name options{ id name } }
        }
      }
    }
  }
}`;

const ITEM_FOR_ISSUE = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    issue(number:$number){
      id url
      projectItems(first:20){
        nodes{
          id
          project{ id }
          fieldValues(first:50){
            nodes{
              ... on ProjectV2ItemFieldSingleSelectValue{
                name
                field{ ... on ProjectV2SingleSelectField{ name } }
              }
            }
          }
        }
      }
    }
  }
}`;

function pickProject(payload) {
  const fromOrg = payload && payload.organization ? payload.organization : null;
  const fromUser = payload && payload.user ? payload.user : null;
  return (fromOrg && (fromOrg.projectV2 || fromOrg.projectsV2)) ||
    (fromUser && (fromUser.projectV2 || fromUser.projectsV2)) ||
    null;
}

function findStatusField(projectId) {
  const res = ghGraphql(STATUS_FIELD, { projectId });
  if (!res.ok) return res;
  const nodes = res.data.node && res.data.node.fields ? res.data.node.fields.nodes : [];
  const field = nodes.find((n) => n && n.name === "Status" && n.options);
  if (!field) {
    return {
      ok: false,
      envFailure: true,
      message: "project has no single-select field named 'Status'",
    };
  }
  return { ok: true, field };
}

function readCard(owner, repo, issueNumber) {
  const res = ghGraphql(ITEM_FOR_ISSUE, {
    owner,
    name: repo,
    number: issueNumber,
  });
  if (!res.ok) return res;
  const issue = res.data.repository && res.data.repository.issue;
  if (!issue) {
    return { ok: false, envFailure: true, message: `issue #${issueNumber} not found` };
  }
  const items = issue.projectItems ? issue.projectItems.nodes : [];
  return { ok: true, issue, items };
}

function currentStatusOf(item) {
  const values = item.fieldValues ? item.fieldValues.nodes : [];
  for (const v of values) {
    if (v && v.field && v.field.name === "Status" && typeof v.name === "string") {
      return v.name;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    owner: "FlapPearLabs",
    repo: "zhihu-grabber-toolkit",
    projectTitle: "Zhihu Engineering Control Board",
    project: null,
    issue: null,
    event: null,
    dryRun: false,
    json: false,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`missing value for ${a}`);
      return argv[i];
    };
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--owner") out.owner = next();
    else if (a === "--repo") out.repo = next();
    else if (a === "--project-title") out.projectTitle = next();
    else if (a === "--project") out.project = Number(next());
    else if (a === "--issue") out.issue = Number(next());
    else if (a === "--event") out.event = next();
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

const USAGE = `Usage:
  kanban-status-transition.mjs --self-test
  kanban-status-transition.mjs --issue <n> --event <EVENT> [--dry-run] [--json]
                               [--project <number>] [--owner <login>] [--repo <name>]

Events:
${EVENT_NAMES.map((e) => `  ${e} -> ${TRANSITIONS.find((t) => t.event === e).to}`).join("\n")}

Exit codes: 0 ok / idempotent noop, 1 contract violation, 2 environment failure.`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function emit(opts, payload, human) {
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(human);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`INVALID_ARGUMENT: ${err.message}`);
    console.error(USAGE);
    process.exit(EXIT_CONTRACT);
  }

  if (opts.selfTest) selfTest();
  if (opts.help) {
    console.log(USAGE);
    process.exit(EXIT_OK);
  }

  if (!Number.isInteger(opts.issue) || opts.issue <= 0) {
    console.error("INVALID_ARGUMENT: --issue <positive integer> is required");
    console.error(USAGE);
    process.exit(EXIT_CONTRACT);
  }
  if (!opts.event || !EVENT_NAMES.includes(opts.event)) {
    console.error(`INVALID_ARGUMENT: --event must be one of ${EVENT_NAMES.join(", ")}`);
    console.error(USAGE);
    process.exit(EXIT_CONTRACT);
  }

  const projectRes = opts.project
    ? ghGraphql(PROJECT_BY_NUMBER, { login: opts.owner, number: opts.project })
    : ghGraphql(PROJECT_BY_TITLE, { login: opts.owner });
  if (!projectRes.ok) {
    console.error(`ENVIRONMENT_FAILURE: ${projectRes.message}`);
    process.exit(EXIT_ENVIRONMENT);
  }

  let project = null;
  if (opts.project) {
    project = pickProject(projectRes.data);
  } else {
    const list = pickProject(projectRes.data);
    const nodes = list && list.nodes ? list.nodes : [];
    project = nodes.find((n) => n.title === opts.projectTitle) || null;
    if (!project) {
      console.error(
        `ENVIRONMENT_FAILURE: no Project titled "${opts.projectTitle}" under ${opts.owner}`,
      );
      process.exit(EXIT_ENVIRONMENT);
    }
  }
  if (!project) {
    console.error("ENVIRONMENT_FAILURE: project not resolvable");
    process.exit(EXIT_ENVIRONMENT);
  }

  const fieldRes = findStatusField(project.id);
  if (!fieldRes.ok) {
    console.error(`ENVIRONMENT_FAILURE: ${fieldRes.message}`);
    process.exit(EXIT_ENVIRONMENT);
  }
  const statusField = fieldRes.field;

  const cardRes = readCard(opts.owner, opts.repo, opts.issue);
  if (!cardRes.ok) {
    console.error(`ENVIRONMENT_FAILURE: ${cardRes.message}`);
    process.exit(EXIT_ENVIRONMENT);
  }
  const item = cardRes.items.find((it) => it.project && it.project.id === project.id);
  if (!item) {
    console.error(
      `ENVIRONMENT_FAILURE: issue #${opts.issue} is not an item of project ${project.number}`,
    );
    process.exit(EXIT_ENVIRONMENT);
  }

  const current = currentStatusOf(item);
  const decision = resolveTransition(opts.event, current);

  if (decision.kind === "REFUSE") {
    emit(
      opts,
      {
        result: "REFUSED",
        reason: decision.reason,
        event: opts.event,
        currentStatus: current,
        issue: opts.issue,
        authorizationUnchanged: true,
      },
      `REFUSED  #${opts.issue}  event=${opts.event}  current=${current}  reason=${decision.reason}\n` +
        "no write performed; AUTHORIZATION_UNCHANGED = YES",
    );
    process.exit(EXIT_CONTRACT);
  }

  if (decision.kind === "NOOP") {
    emit(
      opts,
      {
        result: "NOOP_IDEMPOTENT",
        event: opts.event,
        currentStatus: current,
        issue: opts.issue,
        authorizationUnchanged: true,
      },
      `NOOP  #${opts.issue}  event=${opts.event}  status already ${current}; no write performed`,
    );
    process.exit(EXIT_OK);
  }

  const option = statusField.options.find((o) => o.name === decision.to);
  if (!option) {
    console.error(
      `ENVIRONMENT_FAILURE: Status field has no option named "${decision.to}"`,
    );
    process.exit(EXIT_ENVIRONMENT);
  }

  if (opts.dryRun) {
    emit(
      opts,
      {
        result: "DRY_RUN",
        issue: opts.issue,
        event: opts.event,
        from: current,
        to: decision.to,
        projectNumber: project.number,
        itemId: item.id,
        fieldId: statusField.id,
        optionId: option.id,
        authorizationUnchanged: true,
      },
      `DRY-RUN  #${opts.issue}  ${current} -> ${decision.to}  (no write)\n` +
        `AUTHORIZATION_UNCHANGED = YES\n` +
        `project=${project.number} item=${item.id} field=${statusField.id} option=${option.id}`,
    );
    process.exit(EXIT_OK);
  }

  const edit = spawnSync(
    "gh",
    [
      "project",
      "item-edit",
      "--id",
      item.id,
      "--project-id",
      project.id,
      "--field-id",
      statusField.id,
      "--single-select-option-id",
      option.id,
    ],
    { encoding: "utf8" },
  );
  if (edit.error || edit.status !== 0) {
    console.error(
      `ENVIRONMENT_FAILURE: item-edit failed: ${
        (edit.stderr || edit.stdout || (edit.error && edit.error.message) || "").trim()
      }`,
    );
    process.exit(EXIT_ENVIRONMENT);
  }

  const verifyRes = readCard(opts.owner, opts.repo, opts.issue);
  if (!verifyRes.ok) {
    console.error(`ENVIRONMENT_FAILURE: post-write verification failed: ${verifyRes.message}`);
    process.exit(EXIT_ENVIRONMENT);
  }
  const verifiedItem = verifyRes.items.find((it) => it.project && it.project.id === project.id);
  const observed = verifiedItem ? currentStatusOf(verifiedItem) : null;

  if (observed !== decision.to) {
    emit(
      opts,
      {
        result: "WRITE_NOT_VERIFIED",
        issue: opts.issue,
        event: opts.event,
        from: current,
        expected: decision.to,
        observed,
        authorizationUnchanged: true,
      },
      `WRITE_NOT_VERIFIED  #${opts.issue}  expected=${decision.to} observed=${observed}`,
    );
    process.exit(EXIT_ENVIRONMENT);
  }

  emit(
    opts,
    {
      result: "APPLIED",
      issue: opts.issue,
      event: opts.event,
      from: current,
      to: observed,
      projectNumber: project.number,
      authorizationUnchanged: true,
    },
    `APPLIED  #${opts.issue}  ${current} -> ${observed}  (re-read verified)\n` +
      "AUTHORIZATION_UNCHANGED = YES",
  );
  process.exit(EXIT_OK);
}

main();
