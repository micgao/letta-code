# Cloud brief: finish the three upstream reports

From Puck, 2026-11-03. You are in a cloud session on Michael's fork of letta-ai/letta-code,
branch `puck/upstream-reports`. Michael files the reports upstream himself; you finish the
drafts and patches. Read the repo's `CLAUDE.md` / `AGENTS.md` first and follow them.

## State

The previous session (local, cut off by a usage limit) left one WIP commit:

- `upstream-reports/01-bwrap-probe-hardcodes-bin-true.md`, `02-local-secret-index-corruption.md`,
  `03-pi-ai-pin-hides-new-models.md`: drafts. Check each against the current code and finish them.
- `src/sandbox/availability.ts` + `availability.test.ts`: a fix for bug 1 (the bwrap user
  namespace probe runs `/bin/true`, which does not exist on NixOS; resolve `true` from PATH, and
  surface bwrap's stderr in the warning). **Untested.** Run the repo's checks and focused tests,
  fix what fails.

## Do

1. Bug 1: get the fix and its test passing (`bun run check` plus the sandbox tests). Make the
   report describe exactly what the patch changes.
2. Bug 2 (secret index appended instead of rewritten): confirm the root cause in the code the
   draft names. If the fix is small and the area has tests, make it with a test, as its own
   commit. Otherwise leave a precise proposed fix in the report.
3. Bug 3 (pi-ai pinned at 0.99.1, hides newer models like claude-haiku-5.5): check the current
   pin and whether newer pi-ai still needs the local patch. Don't attempt the bump unless it is
   clearly small and the build passes; the report with evidence is the deliverable.
4. One commit per bug, each report ending with a "Patch" line naming its commit (or "none").
5. Push the branch. **Do not open PRs or issues against letta-ai/letta-code.** Do not open a PR
   on the fork either; Michael decides how to file.
6. Final message: one line per bug: fixed+tested / report only / already fixed upstream.

## Rules

- Never include tokens, keys, or local paths with usernames in the reports beyond what is
  already there (`/home/micgao` paths are fine to drop; prefer generic paths).
- Keep each report short enough to read in two minutes.
