# p1-legacy-checkpoint (fixture)

A **COMPLETE** P1 run directory produced by the *previous* version of the
composer, used to prove that the run-identity repair still resumes historical
default checkpoints (see `test/p1-legacy-checkpoint-resume.test.mjs`).

| | |
|---|---|
| produced by | commit `bfdd489656621160d3fbf97072b52061b0d886e4` (`research-orchestration/lib/p1-runtime-composer.mjs`) |
| identity | runtime `deepseek-api-tool-less`, model `deepseek-v4-pro` (historical default) |
| `state.stage` | `COMPLETE` |
| `state.runId` | `bb8a745ce60523814bd493b35bcd4593942e3a21678cf2f318d8e19c14ca3085` |
| topic | `AI 编程工具会取代程序员吗` |
| offline | yes — providers/capture/runner/embeddings/model were fixtures; no network, no real provider, no real user data |

It carries every artifact the reuse-closure validator walks: `research-plan.json`,
`source-group-selection-decision.json`, `coverage-state.json`,
`coverage-final.json`, `retrieval-rounds/**`, `zhihu/**/answers.json` +
`handoff.json`, `per-group-claims.json`, `cross-source-synthesis.json`,
`research-result.json`, `multi-group-state.json`, `orchestration-state.json`,
`events.jsonl`, plus the `.p1-commit-staging/` leftovers the old code left
behind. All values are synthetic fixtures; no machine path, username or
credential appears in any file.

## Regenerating

`regenerate.mjs` is the exact generator (it imports the composer from a tree of
the revision in `OLD_TREE`):

```bash
TMP=$(mktemp -d)
git archive bfdd489656621160d3fbf97072b52061b0d886e4 | tar -x -C "$TMP"
ln -s "$(pwd)/node_modules" "$TMP/research-orchestration/node_modules"
OLD_TREE="$TMP/research-orchestration" node regenerate.mjs out/checkpoint
```

The generator is documentation, not a test; `node --test test/*.test.mjs` never
runs it.
