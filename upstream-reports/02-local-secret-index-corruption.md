# Local agent secret index becomes unparseable (`Unexpected non-whitespace character after JSON at position 52`)

> **Status: producer not identified.** In main at `8762b9b` (v0.34.39, the
> version where this was seen), letta-code has exactly one writer for the
> index, and it can't produce the corrupted forms below. This report gives the
> evidence and three confirmed defects nearby. It does not include a fix for
> the corruption itself.

## Environment

- NixOS, Linux; Node runtime (no `Bun.secrets`); letta-code 0.34.39
- Local backend, local agent with stored secrets
- Several letta-code processes active at once (TUI plus listener/subagents)

## Steps to reproduce

Not minimal yet: store secrets on a local agent (`letta secret set ...`), keep
the stack running for a while, then run `letta secret list`.

## Actual

```
Unexpected non-whitespace character after JSON at position 52
```

Over time the stored index went through three forms:

1. A valid array `["A","B",...]` (52 characters).
2. `["..."],"NAME"]`: a 52-character array followed by the tail of a longer
   array. That's what you get when a shorter value overwrites a longer one in
   place without truncating it.
3. A bare `A,B,NAME`, which is what `String(array)` produces, not
   `JSON.stringify`.

Hand-repairs didn't hold: the running stack corrupted the index again.
Impact: `loadLocalAgentSecrets` reads the index first, so hydration throws and
new conversations can start with no secrets injected.

## What the code does (`src/utils/secrets-store.ts`, `8762b9b`)

- **Only writer:** `storeLocalSecretNames` (255-263) writes
  `JSON.stringify(normalizeSecretNames(names))`, a full rewrite. Its callers
  are `setLocalAgentSecret` (284), `deleteLocalAgentSecret` (296) and
  `applyLocalSecretBatch` (314). No other code in `src/` names
  `secrets:index` or `local-agent-secrets.json`.
- **Under Node** `globalThis.Bun?.secrets` is `undefined`
  (`src/utils/secrets.ts:9`), so every value, the index included, is stored
  as a JSON string inside `<local-backend>/secrets/local-agent-secrets.json`
  (`writeFileBackedLocalSecrets`, 102-110).
- **A torn file can't explain this.** The index is an escaped string inside
  that outer JSON document. If a write tears the file, the *outer* parse
  fails, and `readFileBackedLocalSecrets` returns `{}`, which shows as "no
  secrets", not as this error. The error means the outer file parsed and the
  index *string* already held forms 2 or 3. So something other than
  `storeLocalSecretNames` wrote that string: another tool, or another build
  that shares the same local-backend dir.
- **Runtime hint:** Node 22 (the supported floor) words this error as
  `... at position 52 (line 1 column 53)`. The reported text has no
  line/column suffix, so check which `node` actually ran the reader.

## Confirmed defects (present at `8762b9b`)

1. **A failed parse wipes the store.** `readFileBackedLocalSecrets` (82-100)
   returns `{}` on any parse error. The next `setFileBackedLocalSecret`
   (116-120) then writes a file holding only the new key, so every other
   secret and the index are deleted.
2. **Non-atomic, unlocked cross-process writes.** `writeFileSync` truncates
   the live file and rewrites it. Nothing locks the file and nothing writes
   to a temp file and renames it. Concurrent processes can tear the file
   (which triggers defect 1) or lose each other's updates.
3. **Lost index update.** `setLocalAgentSecret` snapshots the names, writes
   the value, and then rewrites the index from that snapshot. If another
   process adds a name in between, that name is dropped: the secret is
   stored, but never listed or hydrated.
4. **Split brain across runtimes.** Under Bun, `getAutoLocalSecretValue`
   reads the keychain first, and `setAutoLocalSecretValue` writes there.
   Under Node, both use the file. A Bun dev process and a Node build that
   share one agent therefore keep two different indexes.

## Proposed fix

- **Corruption (pending the producer):** on the affected machine, list every
  process and tool that writes `local-agent-secrets.json`, and check whether
  any build or tool other than letta-code 0.34.39 shares the local-backend
  dir. Inspect key names only, never values.
- **Hardening, each small and independent:**
  - Atomic write in `writeFileBackedLocalSecrets`: write
    `local-agent-secrets.json.<pid>.tmp` with `flush: true`, then
    `renameSync` it over the target.
  - On the write path, throw on a parse failure instead of using `{}`, or
    move the bad file to `*.corrupt-<ts>` first.
  - Serialize the read-modify-write under an `O_EXCL` lockfile next to the
    store, and re-read the index inside the lock (fixes defect 3).
  - Tests belong in `src/cli/commands/secret.test.ts`, which already covers
    the file fallback (`LETTA_SKIP_KEYCHAIN_CHECK=1`,
    `LETTA_LOCAL_BACKEND_DIR`).

Patch: none. The producer isn't confirmed, and per the repo's
"Impossible-State PRs" rule, hardening the reader alone would hide the
symptom without fixing it.
