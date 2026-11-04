# Local model catalog pinned to `@earendil-works/pi-ai@0.99.1`: newer models (e.g. Claude Haiku 5.5) are missing or "Unknown model"

## Environment

- letta-code 0.34.39 (main `8762b9b`), local backend
- Providers: Anthropic, `opencode`, `opencode-go`

## Steps to reproduce

1. Start letta-code with the local backend and connect a provider that serves
   Claude Haiku 5.5.
2. Open `/model`: Claude Haiku 5.5 isn't listed.
3. Select `opencode/claude-haiku-5-5` explicitly.

## Expected

Models the provider serves are listed and can be selected.

## Actual

```
Unknown model "claude-haiku-5-5" for provider "opencode". Choose an available model with /model.
```

## Root cause

- `package.json:155` has `"@earendil-works/pi-ai": "^0.99.1"`. On a 0.x
  version the caret only allows 0.99.x, and `bun.lock` resolves 0.99.1. The
  local catalog is pi-ai's static provider data, which is inlined into the
  bundle at build time.
- The pi-ai tarballs give the following evidence (checked with `npm pack`
  from the registry):
  - npm `latest` is **1.5.0**.
  - `claude-haiku-5-5` is absent from every 0.99.1 provider file.
  - It is present in 1.4.0 and 1.5.0, in `dist/providers/data/`
    `anthropic.json`, `opencode.json` and `opencode-go.json`, among others.
- `src/backend/dev/pi-model-factory.ts:627-632` rejects any `modelId` that
  pi-ai doesn't publish for the provider, so explicit selection fails even
  though the endpoint serves the model.
- `package.json:283` `patchedDependencies` keys
  `patches/@earendil-works%2Fpi-ai@0.99.1.patch` (#5185) to the exact version.

## Is the local patch still needed? Yes

The patch limits the 40-character `tool_call_id` cap in
`dist/api/openai-completions.js` `convertMessages` to real OpenAI/Azure
hosts, so OpenAI-compatible proxies keep long ids. In 1.5.0 the cap is still
unconditional (`if (model.provider === "openai") return id.length > 40 ? ...`,
line 879). The existing patch applies to 1.5.0 unchanged, apart from the
version in its filename and key.

## Trial bump to 1.5.0 (not committed)

Steps: set the version to `1.5.0`, rename the patch, run `bun install`. The
patch applied, and `tsc --noEmit` then failed with 3 errors:

1. The provider `azure-openai-responses` was renamed to `azure`
   (`KnownProvider`). That breaks `src/backend/dev/pi-provider-registry.ts:119`,
   and the old id is also used in `src/backend/dev/pi-api-streams.ts` and
   `src/providers/byok-providers.ts`. Stored connections that use the old id
   need a migration.
2. pi-ai no longer re-exports TypeBox (`Type`, `TSchema`), which breaks
   `src/backend/dev/pi-stream-adapter.ts:9-11`. Fix: add a direct `typebox`
   dependency (pi-ai 1.5.0 uses `typebox@1.3.27`) and import from it.

These are mechanical, but the move is 0.x to 1.x: the provider data was
restructured and the provider was renamed. Doing it properly needs the
provider migration plus the local catalog / pi tests under Bun and the built
Node bundle. That's more than a drive-by.

## Proposed fix

1. Bump to `@earendil-works/pi-ai@1.5.0` (>= 1.4.0 for Haiku 5.5), and rename
   the patch file and its `patchedDependencies` key.
2. Map `azure-openai-responses` to `azure` everywhere LC names providers, and
   migrate stored connections. Add a direct `typebox` import for `Type` and
   `TSchema`.
3. Run `src/backend/dev/pi-openai-tool-call-id.test.ts` (the #5185
   regression), `src/providers/local-pi-provider-catalog.test.ts`, and the
   other `pi-*` and local catalog tests, under Bun and the Node bundle.
4. Upstream the host check to pi-ai so the pin stops being sticky.
5. Decide whether the `haiku` alias (`src/agent/model-catalog.ts:41`, now
   `claude-haiku-4-5`) should move to 5.5.

Patch: none.
