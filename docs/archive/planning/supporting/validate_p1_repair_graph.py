#!/usr/bin/env python3
"""Validate this planning candidate, not product correctness or review approval."""
import json
import re
from pathlib import Path

planning = Path(__file__).resolve().parents[1]
graph = (planning / "P1_REPAIR_TICKET_GRAPH_V1.md").read_text()
decomposition = (planning / "P1_REPAIR_TICKET_DECOMPOSITION_V1.md").read_text()
blocks = re.findall(r"```json\n(.*?)\n```", graph, re.S)
assert len(blocks) == 1, "expected exactly one graph JSON block"
data = json.loads(blocks[0])
tickets = data["tickets"]
ids = [t["id"] for t in tickets]
assert len(ids) == len(set(ids)) == data["ticket_count"] == 10
assert set(ids) == {f"P1-R{i:02d}" for i in range(1, 11)}
by_id = {t["id"]: t for t in tickets}
findings = {f"F{i:02d}" for i in range(1, 9)}
assert set(data["finding_owners"]) == findings
assert {f for t in tickets for f in t["findings"]} == findings
for finding, owners in data["finding_owners"].items():
    assert owners and len(owners) == len(set(owners))
    assert all(owner in by_id and finding in by_id[owner]["findings"] for owner in owners)

required = "ID TITLE TYPE RISK FINDINGS AUTHORITY GOAL ROOT_CAUSE TARGET_CONTRACT IN_SCOPE OUT_OF_SCOPE PRODUCTION_ENTRYPOINT PRODUCTION_CALLER TEST_CALLER LIKELY_FILES_COMPONENTS OUTPUTS BLOCKED_BY BLOCKS ACCEPTANCE_CRITERIA REQUIRED_TESTS COUNTEREXAMPLES STOP_CONDITIONS REVIEWER_QUORUM REQUIRED_REVIEWER_ROLE REVIEWER_ROUTE MODEL_RECOMMENDATION IMPLEMENTATION_NOTES_NON_AUTHORITY".split()
sections = re.findall(r"^### (P1-R\d{2}) — [^\n]+\n(.*?)(?=^### P1-R|^## 5\.|\Z)", decomposition, re.M | re.S)
assert len(sections) == len(ids) and {s[0] for s in sections} == set(ids)
for ticket_id, section in sections:
    fields = dict(re.findall(r"^- \*\*([A-Z_]+)\*\*: (.*?)(?=\n- \*\*|\Z)", section, re.M | re.S))
    # Acceptance criteria start on the following line.
    if "ACCEPTANCE_CRITERIA" not in fields:
        ac = re.search(r"^- \*\*ACCEPTANCE_CRITERIA\*\*:\n(.*?)(?=\n- \*\*)", section, re.M | re.S)
        assert ac, ticket_id + " missing AC"
        fields["ACCEPTANCE_CRITERIA"] = ac.group(1)
    assert set(required) <= set(fields), (ticket_id, set(required) - set(fields))
    assert all(fields[k].strip() for k in required)
    t = by_id[ticket_id]
    assert fields["ID"].strip() == ticket_id
    assert fields["TYPE"].strip() == t["type"]
    assert set(re.findall(r"F\d{2}", fields["FINDINGS"])) == set(t["findings"])
    assert "- [ ]" in fields["ACCEPTANCE_CRITERIA"]
    assert "INTERNAL_SUBAGENT" in fields["REVIEWER_ROUTE"]
    for key in ("blocked_by", "blocks"):
        expected = t[key]
        actual = re.findall(r"P1-R\d{2}", fields[key.upper()])
        assert actual == expected, (ticket_id, key, actual, expected)
        assert len(expected) == len(set(expected)) and ticket_id not in expected
        assert all(target in by_id for target in expected)
    if t["type"] in {"CODE", "SECURITY/CODE"}:
        assert "RED" in fields["REQUIRED_TESTS"] and "GREEN" in fields["REQUIRED_TESTS"]
        assert "research-orchestration/bin/research-p1.mjs" in fields["PRODUCTION_ENTRYPOINT"]
    for target in t["blocks"]:
        assert ticket_id in by_id[target]["blocked_by"]
    for source in t["blocked_by"]:
        assert ticket_id in by_id[source]["blocks"]

def table_ids(cell):
    return re.findall(r"P1-R\d{2}", cell)

rows = [line.split("|")[1:-1] for line in graph.splitlines() if line.startswith("| P1-R")]
assert len(rows) == len(ids)
for row in rows:
    tid = row[0].strip()
    assert table_ids(row[1]) == by_id[tid]["blocked_by"]
    assert table_ids(row[2]) == by_id[tid]["blocks"]
    assert row[3].strip() == by_id[tid]["lane"]
index_rows = [line.split("|")[1:-1] for line in decomposition.splitlines() if line.startswith("| P1-R")]
assert len(index_rows) == len(ids)
for row in index_rows:
    tid = row[0].strip()
    assert table_ids(row[-1]) == by_id[tid]["blocked_by"]
    assert row[1].strip() == by_id[tid]["lane"]
    assert row[3].strip() == by_id[tid]["type"]
coverage_rows = [line.split("|")[1:-1] for line in decomposition.splitlines() if re.match(r"\| F\d{2} \|", line)]
assert len(coverage_rows) == 8
for row in coverage_rows:
    assert table_ids(row[1]) == data["finding_owners"][row[0].strip()]

remaining, order, waves = set(ids), [], []
while remaining:
    ready = sorted(t for t in remaining if set(by_id[t]["blocked_by"]) <= set(order))
    assert ready, "cycle detected"
    waves.append(ready)
    order.extend(ready)
    remaining.difference_update(ready)
paths = {}
for tid in order:
    parents = by_id[tid]["blocked_by"]
    paths[tid] = (max((paths[p] for p in parents), key=len) if parents else []) + [tid]
assert max(paths.values(), key=len) == data["critical_path"]
edges = {(t["id"], b) for t in tickets for b in t["blocks"]}
mermaid = re.search(r"```mermaid\n(.*?)\n```", graph, re.S).group(1)
mermaid_edges = {(f"P1-{a}", f"P1-{b}") for a, b in re.findall(r"(R\d{2})(?:\[[^\n]*?\])? --> (R\d{2})", mermaid)}
assert mermaid_edges == edges, "Mermaid and JSON edges differ"
for source, target in edges:
    seen, queue = {source}, [source]
    while queue:
        node = queue.pop()
        for child in by_id[node]["blocks"]:
            if (node, child) == (source, target):
                continue
            if child not in seen:
                seen.add(child)
                queue.append(child)
    assert target not in seen, (source, target, "redundant transitive edge")
assert by_id["P1-R09"]["blocks"] == []
assert set(data["conditional_execution_gates"]) == {"ALL", "P1-R03", "P1-R10"}
assert all(data["conditional_execution_gates"].values())
for document in (graph, decomposition):
    assert "STATUS = REVIEW_PENDING" in document
    assert "IMPLEMENTATION_AUTHORIZATION = NONE" in document
    assert "ISSUE_CREATION_AUTHORIZATION = NONE" in document
print(json.dumps({"status": "PASS", "ticket_count": len(ids), "direct_edge_count": len(edges),
    "finding_coverage": "F01-F08", "reciprocity": "PASS", "acyclic": "PASS",
    "no_transitive_edges": "PASS", "document_consistency": "PASS", "waves": waves,
    "critical_path": data["critical_path"], "independent_review": "NOT_PERFORMED"}, indent=2))
