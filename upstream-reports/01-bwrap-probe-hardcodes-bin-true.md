# Sandbox probe hard-codes `/bin/true`, so bwrap is reported unavailable on NixOS

## Environment

- OS: NixOS (no FHS layout; `/bin/true` does not exist)
- letta-code 0.34.39, run under Node, local backend
- bubblewrap installed and on `PATH`; unprivileged user namespaces enabled

## Steps to reproduce

1. On NixOS, with `bwrap` on `PATH`, start letta-code.
2. Trigger a memory subagent (e.g. let reflection run).

Equivalent manual probe:

```sh
bwrap --ro-bind / / --unshare-user /bin/true; echo $?              # non-zero
bwrap --ro-bind / / --unshare-user "$(command -v true)"; echo $?   # 0
```

## Expected

The bwrap backend is detected and the memory subagent runs inside the
filesystem sandbox.

## Actual

```
[sandbox] WARNING: memory-subagent sandbox requested filesystem isolation, but no kernel sandbox backend is available (bwrap present but user namespaces are unavailable). Continuing without filesystem sandbox isolation.
```

Memory subagents run **without** filesystem isolation, although user namespaces
work on this host.

## Root cause

`src/sandbox/availability.ts` (main at `8762b9b`, v0.34.39), `probeBwrap()`,
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

bwrap creates the namespace, then fails at `execvp /bin/true`. The probe
can't tell that exit from a real namespace failure, and it discards bwrap's
stderr, so the warning blames user namespaces when the cause is a missing
binary.

## Fix (patch on this branch)

Only `src/sandbox/availability.ts` changes, plus a new
`src/sandbox/availability.test.ts`:

1. The user-namespace probe runs `true` resolved from `PATH` with the
   existing `resolveExecutableOnPath()`. The probe bind-mounts the host root,
   so the host path (e.g. `/run/current-system/sw/bin/true`) is visible inside
   the sandbox. If `true` isn't on `PATH`, it runs `<bwrap> --version` inside
   the sandbox instead (bwrap was just found), so no FHS path is assumed.
2. On failure, the first line of bwrap's stderr (or the spawn error message),
   capped at 200 characters, is appended to `reason`:
   `bwrap present but user namespaces are unavailable: bwrap: execvp /bin/true: No such file or directory`.
3. `probeBwrap` is exported and takes optional `{ spawn, envPath }` deps
   (default `spawnSync` / `process.env.PATH`), so it is unit-tested without
   `mock.module`. `detectSandboxBackend()` behaviour is otherwise unchanged.

Tests (4 new): `true` comes from `PATH`, not `/bin/true`; fallback to
`bwrap --version` when `true` is missing; stderr reaches `reason`; missing
bwrap spawns nothing. `bun test src/sandbox/` (32 pass) and `bun run check`
(13/13) pass. Not run on a real NixOS host from this session (no bwrap in the
test container).

Not affected: Seatbelt on macOS checks `/usr/bin/sandbox-exec`, which exists
there.

Patch: `6d86d62` (`fix(sandbox): resolve true from PATH in bwrap userns probe`)
on `puck/upstream-reports`, on top of WIP commit `b8d2819`, which holds most of
the code change. Squash both when filing.

## Workaround on NixOS

Until the fix lands, NixOS users can enable `services.envfs.enable = true;`, which mounts
an `/bin` (and `/usr/bin`) that resolves any program through the caller's `PATH`, so
`/bin/true` exists and the probe succeeds. It is opt-in and most NixOS systems don't
have it, so the probe should still resolve `true` from `PATH` itself.
