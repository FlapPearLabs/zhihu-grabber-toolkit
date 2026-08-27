# Integrity manifest authority — final history patch

The WorkBuddy-published audit snapshot originally contained:

`review/FILES_SHA256.txt`

That 523-entry file is preserved as the integrity record for the snapshot that existed at commit `c3f5e9c26e1a330f63fbbd85ede9a96a2db824b0` before the final historical-completeness patch.

After that snapshot, ChatGPT added/updated audit-only historical/context/reviewer files. Those post-snapshot files are identified by Git history rather than by pretending the old manifest still covers them.

## Final snapshot identity

The authoritative identity for the complete current audit tree is the **audit branch commit SHA** reported by GitHub for:

`audit/claude-external-review-2026-08-27`

The reviewer should record the exact commit SHA actually reviewed.

## Verification semantics

- For an original file that was not modified after `c3f5e9c`, `FILES_SHA256.txt` remains a useful per-file integrity record.
- For files added or changed by the final historical-completeness patch, use Git commit/tree identity and inspect the file content directly.
- `FILES_SHA256.txt` must not be misrepresented as covering files added after its creation.
- No unverified V3 per-file SHA256 overlay is provided.

This is intentional: an incomplete but accurately scoped integrity statement is preferable to an apparently precise hash table that was not independently recomputed from the remote final tree.

The final-history patch modifies audit material only. It does not modify production code, Semantic Gold, selectors, metrics, corpus, benchmark behavior, or corrected D2 results.
