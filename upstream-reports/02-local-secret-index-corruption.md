# Local agent secret index becomes unparseable (`Unexpected non-whitespace character after JSON at position 52`)

> **Status: producer not yet identified.** The newest source available when
> this was drafted (origin/main `ebd590b11`, package version 0.34.36) has no
> code path that appends to the index. The bug was seen on 0.34.39. See
> "Open questions" before filing.

## Environment

- OS: NixOS, Linux; Node runtime (no `Bun.secrets`)
- letta-code 0.34.39, built from `numtide/llm-agents.nix`
- Backend: local, with a local agent that has stored secrets
- Several letta-code processes active at once (TUI plus listener/subagents)

## Steps to reproduce

Not yet minimal. Observed sequence:

1. Store secrets on a local agent (`/secret set ...` or `letta secret set ...`).
2. Keep the normal stack running and use it for a while.
3. Run `/secret list` or `letta secret list`.

## Expected

The secret names are listed. New conversations hydrate every secret.

## Actual

```
Unexpected non-whitespace character after JSON at position 52
```

The stored index value went through three forms over time:

1. A clean JSON array: `["A","B",...]` (exactly 52 characters).
2. Two arrays run together: `["..."],"NAME"]`. Parsing stops at character
   52, which is the error position.
3. A bare comma-joined string (`A,B,NAME`). This is what `String(array)` or
   `array.join(",")` produces, not `JSON.stringify`.

Fixing the file by hand didn't last: the running stack corrupted it again.

**Impact:** `loadLocalAgentSecrets` reads the index first. If the index can't
be parsed, fresh secret hydration fails, and a new conversation can start
with no secrets (API keys) injected.

## Where the index is written (origin/main `ebd590b11`)

All references are to `src/utils/secrets-store.ts` unless noted.

- **Index read**, `loadLocalSecretNames`, lines 240-253:
  `JSON.parse(raw)`. The `SyntaxError` is rethrown as-is, which is the text
  users see.
- **Index write**, `storeLocalSecretNames`, lines 255-263:
  `JSON.stringify(normalizeSecretNames(names))`. This is a **full rewrite**,
  and it's the only writer of `agent:<id>:secrets:index` in the tree.
  Callers: `setLocalAgentSecret` (284-294), `deleteLocalAgentSecret`
  (296-312), `applyLocalSecretBatch` (314-339).
- **Storage under Node:** `src/utils/secrets.ts:9` reads
  `globalThis.Bun?.secrets`, which is `undefined` in the Node-targeted
  bundle. `setAutoLocalSecretValue` (141-155) therefore always falls back to
  the file store `<local-backend>/secrets/local-agent-secrets.json`. That
  store keeps every value, the index included, as a string inside
  `{ "secrets": { ... } }`.

None of these paths can produce forms 2 or 3. The writer that appends is in
code newer than 0.34.36, or outside letta-code.

## Related defects found while tracing (present on origin/main)

These don't produce the concatenated index on their own, but they make the
store fragile under the multi-process setup where the bug appeared:

1. **Parse failure is treated as "empty", which wipes the store.**
   `readFileBackedLocalSecrets` (lines 82-100) returns `{}` from its `catch`.
   The next `setFileBackedLocalSecret` (116-120) then writes a file holding
   only the new key, silently deleting every other secret and the index.
2. **Unlocked, non-atomic, cross-process read-modify-write.**
   `writeFileBackedLocalSecrets` (102-110) calls `writeFileSync` on the live
   path (truncate, then write) with no lock and no temp-file rename. Two
   processes that interleave can leave a torn file. That triggers defect 1,
   or one process's update gets lost.
3. **Index lost update.** `setLocalAgentSecret` loads the names, writes the
   value, and then rewrites the index from its own snapshot (284-294). A
   concurrent writer's new name gets dropped, so the secret is stored but
   never listed or hydrated.

## Proposed fix

- **Root cause (pending):** find the 0.34.39 writer that appends to or joins
  the index (see below) and make it go through `storeLocalSecretNames`.
- **Hardening (small, independent):**
  - Write `local-agent-secrets.json` atomically: write
    `local-agent-secrets.json.<pid>.tmp` with `flush: true`, then `renameSync`
    it over the target.
  - Don't turn a parse failure into `{}` on the write path. Throw (or move the
    bad file to `*.corrupt-<ts>`) so one bad read can't erase the store.
  - Serialize read-modify-write with a lockfile (e.g. an `O_EXCL` lock next to
    the store) so the TUI, listener, and subagents don't lose each other's
    updates.

No code change is included for this bug. Hardening the consumer without
finding the producer would hide the symptom rather than fix it.

## Open questions (to settle before filing)

1. Get the 0.34.39 source and look for other writers:
   `git fetch origin && git log --oneline v0.34.36..v0.34.39 -- src/utils/secrets-store.ts src/utils/secrets.ts`,
   and `grep -n 'secrets:index' <letta.js bundle>`.
2. Check which store holds the index on the affected machine (keychain vs
   `local-agent-secrets.json`), using **key names only**.
3. List every process that was running when it re-corrupted (TUI, listener,
   reflection subagent, any external tool that writes the same file).
