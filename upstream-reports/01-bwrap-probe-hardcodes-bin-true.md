# Sandbox probe hard-codes `/bin/true`, so bwrap is reported unavailable on NixOS

## Environment

- OS: NixOS (no FHS layout; `/bin/true` does not exist)
- letta-code 0.34.39, built from `numtide/llm-agents.nix`, run under Node
- Backend: local
- bubblewrap installed and on `PATH`; unprivileged user namespaces enabled

## Steps to reproduce

1. On NixOS, with `bwrap` on `PATH`, start letta-code with the local backend.
2. Trigger a memory subagent (e.g. let reflection run).

Equivalent manual probe:

```sh
bwrap --ro-bind / / --unshare-user /bin/true; echo $?        # non-zero
bwrap --ro-bind / / --unshare-user "$(command -v true)"; echo $?  # 0
```

## Expected

The bwrap backend is detected and the memory subagent runs inside the
filesystem sandbox.

## Actual

```
[sandbox] WARNING: memory-subagent sandbox requested filesystem isolation, but no kernel sandbox backend is available (bwrap present but user namespaces are unavailable). Continuing without filesystem sandbox isolation.
```

Memory subagents run **without** filesystem isolation, although user namespaces
work fine on this host.

## Root cause

`src/sandbox/availability.ts` (origin/main `ebd590b11`), `probeBwrap()`,
lines 150-163:

```ts
const userns = spawnSync(
  bwrapPath,
  ["--ro-bind", "/", "/", "--unshare-user", "/bin/true"],
  { timeout: 5000 },
);
if (userns.error || userns.status !== 0) {
  return { backend: null, reason: "bwrap present but user namespaces are unavailable" };
}
```

bwrap sets up the namespace successfully and then fails at `execvp /bin/true`.
The probe can't tell that exit apart from a real namespace failure, and it
throws away bwrap's stderr. So the warning blames user namespaces when the
real cause is a missing binary.

The same file already has `resolveExecutableOnPath()` (used for `bwrap`).
Because the probe bind-mounts the host root, a `true` resolved from the host
`PATH` (e.g. `/run/current-system/sw/bin/true`) is also visible inside the
sandbox.

## Proposed fix

(Implemented on this branch: `src/sandbox/availability.ts` and the new
`src/sandbox/availability.test.ts`.)

1. Resolve `true` from `PATH`. If it isn't there, run `bwrap --version`
   inside the sandbox instead (bwrap is already known to exist), so the probe
   never depends on an FHS path.
2. Append the first line of bwrap's stderr (or the spawn error) to the
   `reason`, e.g.
   `bwrap present but user namespaces are unavailable: bwrap: execvp /bin/true: No such file or directory`.
3. `probeBwrap` now takes injectable `spawn`/`envPath` deps so it can be
   unit-tested without `mock.module`.

Related, not changed here: the macOS docs mention probing Seatbelt with
`/usr/bin/true`. That path does exist on macOS, so it isn't affected.
