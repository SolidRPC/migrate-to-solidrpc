# Forward evaluation report

Date: 2026-08-26

This report records independent-agent evaluations of `migrate-to-solidrpc`. Each agent received the skill path, one migration request, and a fresh temporary copy of `tests/fixtures/viem-app-before`. The agents did not receive another evaluator's output. Real credentials were unavailable by design.

## Source fixture

The untouched fixture is a Node.js 22 TypeScript application using viem 2.55.19. It has:

- portable HTTPS reads through `PRIMARY_RPC_URL`;
- signed raw transaction submission through the same provider;
- a separate WebSocket block subscription through `PRIMARY_WS_URL`;
- deterministic JSON-RPC mocks on ephemeral local ports; and
- three passing baseline tests.

Before the evaluation copies were made, the fixture passed `npm ci`, `npm run typecheck`, and `npm test` (3/3 tests).

## Independent runs

### Default add mode

Request: add SolidRPC to the application using the skill's default behavior.

Workspace: `/private/tmp/migrate-eval-add.eUpSkQ`

Result: passed. The agent preserved every production HTTP, write, and WebSocket route. It added a manually invoked `compare:solidrpc` command that verifies the live catalog, resolves a finalized block through the existing provider, confirms the same canonical block hash through SolidRPC, and compares `eth_getBalance` at that exact block. The existing provider remains authoritative on mismatch.

Resulting diff:

- Added `.gitignore`, `SOLIDRPC_MIGRATION.md`, `src/compare-solidrpc.ts`, `src/solidrpc-comparison.ts`, and `test/solidrpc-comparison.test.ts`.
- Updated `.env.example`, `README.md`, `package.json`, `src/config.ts`, and `test/provider.test.ts`.
- No production provider construction or WebSocket implementation changed.

Evidence:

- `npm run typecheck`: passed.
- `npm test`: 9/9 tests passed.
- Missing credentials stop before provider traffic.
- Catalog failure or missing method-family coverage stops before provider traffic.
- Mismatches are reported without replacing the production result.
- `eth_sendRawTransaction` reaches the existing provider exactly once and never reaches SolidRPC.
- The comparison uses the clean endpoint with `X-API-Key`; no key is printed or committed.

### Explicit replace request without credentials

Request: replace the current main HTTPS JSON-RPC provider with SolidRPC, while retaining incompatible WebSocket behavior.

Workspace: `/private/tmp/migrate-eval-replace.xzThMT`

Result: safely blocked. The live catalog qualified Ethereum chain 1 for the observed `standard` calls, but authenticated representative probes could not run without a key. The agent prepared an isolated, inactive SolidRPC candidate and left all production traffic on the existing provider. It did not add a runtime cutover flag, automatic fallback, mirror, or fanout.

Resulting diff:

- Added `SOLIDRPC_MIGRATION.md`.
- Updated `.env.example`, `README.md`, `src/config.ts`, `src/provider.ts`, and `test/provider.test.ts`.
- The production entrypoint remained on `PrimaryRpc`; the candidate was reachable only from deterministic tests.

Evidence:

- `npm run typecheck`: passed.
- `npm test`: 5/5 tests passed.
- Existing-provider reads and writes remained active; SolidRPC received zero application traffic.
- Candidate requests used `X-API-Key` and exactly-once write tests issued one request.
- The WebSocket/`eth_subscribe` path remained explicitly on the legacy provider.
- `SOLIDRPC_MIGRATION.md` records the missing credential and authenticated-probe gates before cutover.

This is the expected safe outcome: an explicit replacement request does not override failed qualification gates.

### Catalog-driven chain discovery

Request: replace the provider for chain ID `999999999`, initially chosen by the test author as an assumed unsupported chain.

Workspace: `/private/tmp/migrate-eval-unsupported.WEz6Yy`

Result: the assumption was disproved by the skill. The agent fetched the live catalog and found chain `999999999` as live Zora Sepolia with `standard` and `debug` families and full/archive coverage. It prepared an inactive candidate, but blocked cutover because credentials and authenticated representative probes were absent, the fixture itself was still hardcoded for chain 1, and WebSocket subscriptions were incompatible.

Resulting diff:

- Added `.gitignore`, `SOLIDRPC_MIGRATION.md`, `src/solidrpc.ts`, and `test/solidrpc.test.ts`.
- Updated `.env.example` and `README.md`.
- Production source remained unchanged.

Evidence:

- `npm run typecheck`: passed.
- `npm test`: 7/7 tests passed.
- Live catalog response contained 57 networks and identified `999999999` dynamically.
- No hardcoded support assumption caused an unsafe cutover.

### Truly absent chain

Request: replace the provider for chain ID `2147483647`.

Workspace: `/private/tmp/migrate-eval-absent.bVdfqj`

Result: safely blocked. The live catalog returned HTTP 200 with 57 networks and no matching chain. The agent made no source or routing change, added no SolidRPC candidate, requested no credential, and documented the failed coverage gate.

Resulting diff:

- Added only `.gitignore` and `SOLIDRPC_MIGRATION.md`.
- Production source, tests, tracked environment example, and active routes were byte-for-byte unchanged.

Evidence:

- `npm run typecheck`: passed.
- `npm test`: 3/3 baseline tests passed.
- SolidRPC received zero traffic.
- The migration record identifies catalog coverage, application chain identity, authenticated probes, exactly-once writes, and WebSocket handling as unresolved gates.

## Repository validation

The final repository was checked with:

```text
python3 <skill-creator>/scripts/quick_validate.py skills/migrate-to-solidrpc
cd examples/viem-app && npm ci && npm run typecheck && npm test
cd tests/fixtures/viem-app-before && npm ci && npm run typecheck && npm test
git diff --check
```

Outcomes:

- Structural skill validation: passed.
- Migrated sample: type checking passed; 6/6 tests passed.
- Untouched fixture: type checking passed; 3/3 tests passed.
- Dependency audit: zero reported vulnerabilities in both Node.js projects.
- Tracked-file secret scan: no API-key-shaped values, credential-bearing SolidRPC URLs, or real environment files found.
- Optional keyless public smoke: `eth_chainId` against `https://rpc.solidrpc.io/public/evm/1` returned `0x1`. This was non-gating and is not production qualification.

## Conclusions and limitations

The independent runs demonstrate the intended fail-closed behavior across default add mode, explicit replacement, writes, WebSocket incompatibility, live-catalog discovery, absent coverage, catalog failure, and missing credentials. Default mode does not alter production routing; replacement occurs only after qualification, and none of these no-credential runs qualified a real cutover.

Known limitations:

- No private SolidRPC API key was available, so authenticated production behavior was not qualified.
- Deterministic mocks prove routing invariants, not production reliability or full method semantics.
- The optional public endpoint smoke proves only a basic keyless Ethereum response.
- The fixture exercises viem in a trusted Node.js runtime; browser-only, other-client, enhanced API, webhook, and non-EVM adaptations still require project-specific evaluation.
- WebSocket subscriptions remain partial migrations until the application retains the legacy path deliberately or adopts a supported polling design.
- The SolidRPC website CTAs and public/plugin distribution remain unchanged pending review.
