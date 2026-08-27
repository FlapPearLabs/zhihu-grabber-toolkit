# Integrity manifest authority — final history patch

The audit snapshot was originally published with:

`review/FILES_SHA256.txt`

That file is preserved as the immutable manifest of the WorkBuddy-published snapshot before the final historical-completeness patch.

The final patch added/updated a small set of audit-only files. Their authoritative hashes are stored in:

`review/FILES_SHA256_V3_PATCH.txt`

## Verification rule

Construct the effective manifest as follows:

1. Start with every path/hash from `FILES_SHA256.txt`.
2. For any path also present in `FILES_SHA256_V3_PATCH.txt`, replace the old hash with the V3 hash.
3. Add V3-only paths from the patch file.
4. `FILES_SHA256_V3_PATCH.txt` itself is excluded from its own listing.

Therefore:

- original snapshot paths not touched by the patch → verify against `FILES_SHA256.txt`;
- patched or newly added paths → verify against `FILES_SHA256_V3_PATCH.txt`.

This overlay approach deliberately preserves the original WorkBuddy integrity record instead of rewriting history.

The final-history patch is audit material only and does not modify production code, benchmark Gold, selectors, metrics, corpus, or corrected D2 results.
