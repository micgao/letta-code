# Local model catalog pinned to `@earendil-works/pi-ai@^0.99.1`: newer models (e.g. Claude Haiku 5.5) are missing or "Unknown model"

## Environment

- letta-code 0.34.39, built from `numtide/llm-agents.nix`, local backend
- Providers: Anthropic, `opencode`, `opencode-go`

## Steps to reproduce

1. Start letta-code with the local backend and connect a provider that serves
   Claude Haiku 5.5.
2. Open `/model`: Claude Haiku 5.5 isn't listed.
3. Select `opencode/claude-haiku-5-5` or `opencode-go/claude-haiku-5-5`
   explicitly.

## Expected

Models the connected provider serves show up in the picker and can be
selected.

## Actual

They're missing from the picker and catalog. Explicit selection fails:

```
Unknown model "claude-haiku-5-5" for provider "opencode". Choose an available model with /model.
```

(OpenCode does serve this model.)

## Root cause (origin/main `ebd590b11`)

- `package.json:152` still pins `"@earendil-works/pi-ai": "^0.99.1"`, added
  in 67bf68bf8 (#4861). The local catalog is pi-ai's static provider data,
  which gets inlined into the bundle at build time. 0.99.1 predates Claude
  Haiku 5.5 (pi-ai 1.4.0 has it).
- `src/backend/dev/pi-model-factory.ts:627-632`: the local turn path rejects
  any `modelId` that pi-ai doesn't publish for that provider. That produces
  the "Unknown model" error for `opencode`/`opencode-go` even though the
  endpoint serves the model.
- The pin is sticky because `package.json:282` `patchedDependencies` applies
  `patches/@earendil-works%2Fpi-ai@0.99.1.patch` (75d7921f1, #5185). The patch
  is keyed to the exact version and edits
  `dist/api/openai-completions.js` (`convertMessages`). It caps the replayed
  `tool_call_id` at 40 characters only for real OpenAI/Azure hosts, so
  OpenAI-compatible proxies (e.g. LiteLLM) keep long ids that carry Gemini
  thought signatures. Any bump has to rebase or drop this patch.
- Related: `src/agent/model-catalog.ts:43` hard-codes the `haiku` CLI alias to
  `claude-haiku-4-5`. Once 5.5 is in the catalog, decide whether the alias
  should point to it.

## Proposed fix

1. Bump `@earendil-works/pi-ai` to the current release that includes Claude
   Haiku 5.5 (>= 1.4.0).
2. Patch:
   - If newer pi-ai already limits the 40-char cap to OpenAI hosts (look in
     `dist/api/openai-completions.js` for the `model.provider === "openai"`
     id-normalization branch), drop the patch and its `patchedDependencies`
     entry.
   - Otherwise rebase the patch onto the new `dist` layout, rename it to the
     new version, and upstream the fix to pi-ai so the pin stops being
     sticky.
3. Keep the existing regression test from #5185 green, and run the local
   catalog tests (`setupRuntimeModelCatalogFixture` users) under both Bun
   and the built Node bundle.

## Not verified while drafting

npm registry access wasn't available, so these are still open:

- the exact latest pi-ai version, and whether 1.x contains the #5185 fix;
- whether 1.x's `opencode` / `opencode-go` provider data lists
  `claude-haiku-5-5`.

To check:
`npm view @earendil-works/pi-ai versions` and
`npm pack @earendil-works/pi-ai@latest`, then grep the tarball's
`dist/api/openai-completions.js` and its models data.
