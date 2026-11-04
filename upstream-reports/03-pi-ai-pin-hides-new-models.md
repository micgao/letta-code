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
line 879). 1.4.0 has the same unconditional cap. The existing patch applies to both
1.4.0 and 1.5.0 unchanged, apart from the version in its filename and key.

## Trial bumps (not committed)

For each version: set it in `package.json`, rename the patch and its
`patchedDependencies` key, run `bun install`, regenerate
`npm-shrinkwrap.json` (`bun run runtime-graph:generate`, which needs the
pinned npm 12.2.0 and Bun 1.3.14), then run `bun run check`. The patch
applied cleanly both times. Every check passed except `tsc`.

**1.5.0**, 3 errors:

```
src/backend/dev/pi-provider-registry.ts(119,5): error TS2353: Object literal may only specify known properties, and '"azure-openai-responses"' does not exist in type 'Partial<Record<KnownProvider, string>>'.
src/backend/dev/pi-stream-adapter.ts(9,3): error TS2305: Module '"@earendil-works/pi-ai"' has no exported member 'TSchema'.
src/backend/dev/pi-stream-adapter.ts(11,29): error TS2305: Module '"@earendil-works/pi-ai"' has no exported member 'Type'.
```

1.5.0 drops TypeBox entirely: its dependencies list
`@earendil-works/pi-schema` and no `typebox`. Tool schemas would have to be
ported to pi-schema's builders. Adding a direct `typebox` dependency would
type-check, but pi-ai would no longer share that schema type.

**1.4.0** (the first version with Haiku 5.5; still depends on
`typebox@1.3.27` and re-exports `Type`/`TSchema`), 1 error:

```
src/backend/dev/pi-provider-registry.ts(119,5): error TS2353: Object literal may only specify known properties, and '"azure-openai-responses"' does not exist in type 'Partial<Record<KnownProvider, string>>'.
```

**First real blocker: the Azure provider id.** From 1.4.0 on, the provider
`azure-openai-responses` is `azure`. The *API* name `azure-openai-responses`
is unchanged, so `src/backend/dev/pi-api-streams.ts` is fine as written.
pi-ai ships no alias for the old provider id. The compile fix is two keys:
`PI_TUI_DEFAULT_MODEL_IDS` in `pi-provider-registry.ts` and
`LOCAL_PROVIDER_DISPLAY_NAMES` in `src/providers/byok-providers.ts`. The
open part is stored state. Existing `azure-openai-responses/<model>`
handles and saved provider credentials would stop resolving unless LC maps
the old id to `azure` when it loads them. That is a maintainer decision, so
the bump stops here.

## Proposed fix

1. Bump to exactly `1.4.0`. It is the smallest jump that has Haiku 5.5 and
   avoids the pi-schema port. Rename the patch to `@1.4.0` (content
   unchanged) and regenerate `npm-shrinkwrap.json`.
2. Rename the two `azure-openai-responses` provider keys to `azure`, and map
   the old provider id to `azure` wherever stored handles and auth are
   loaded.
3. Run `src/backend/dev/pi-openai-tool-call-id.test.ts` (the #5185
   regression), `src/providers/local-pi-provider-catalog.test.ts`, and the
   other `pi-*` and local catalog tests, under Bun and the Node bundle.
4. Upstream the host check to pi-ai so the pin stops being sticky.
5. Later, for 1.5.x: port `pi-stream-adapter.ts` from TypeBox to pi-schema.
6. Decide whether the `haiku` alias (`src/agent/model-catalog.ts:41`, now
   `claude-haiku-4-5`) should move to 5.5.

Patch: none (bump blocked by the Azure provider-id rename; see "Trial bumps").
