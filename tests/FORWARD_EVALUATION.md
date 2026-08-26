# Forward evaluation report

Date: 2026-08-26

This report records independent-agent evaluations of `migrate-to-solidrpc`. Each agent received the skill path, one migration request, and a fresh temporary copy of `tests/fixtures/viem-app-before`. The agents did not receive another evaluator's output. Real credentials were unavailable to those agents by design. After the independent runs, an owner-supplied temporary credential was used for a separate sanitized, read-only live probe.

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

## Authenticated live read probe

Run time: `2026-08-26T08:19:00Z`

Credential handling: an owner-supplied temporary key was read silently into an in-memory environment variable, inherited only by the probe process, unset before exit, and never placed in a command line, file, report, URL, or output. The repository was scanned afterward for API-key-shaped values and real environment files; none were found, and the working tree remained clean.

The live catalog qualified Ethereum chain ID 1 as `live` with full/archive node types and `standard`, `trace`, and `debug` method families. Two read-only checks then used the sample application itself:

1. **Add-mode comparison:** `RPC_PRIMARY=legacy` used `https://ethereum-rpc.publicnode.com` as an independent existing-provider route and the clean SolidRPC endpoint with `X-API-Key`. Both providers returned the same canonical block hash and the same balance at block `25838127`; the command returned `status: match` with the legacy result still authoritative.
2. **Replace-mode read:** `RPC_PRIMARY=solidrpc` used the authenticated SolidRPC endpoint while `LEGACY_RPC_URL` deliberately pointed to unreachable `http://127.0.0.1:1`. The balance read succeeded and reported `provider: solidrpc`, demonstrating that the live replacement read did not touch the legacy route.

No transaction, signing request, trace/debug call, archive-depth boundary, WebSocket request, or state-changing method was sent. The deterministic tests remain the evidence for exactly-once write routing.

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
- Authenticated live Ethereum read: passed through the clean endpoint with `X-API-Key`, including stable-block comparison and a SolidRPC-only replacement read.

## Conclusions and limitations

The independent runs demonstrate the intended fail-closed behavior across default add mode, explicit replacement, writes, WebSocket incompatibility, live-catalog discovery, absent coverage, catalog failure, and missing credentials. Default mode does not alter production routing; replacement occurs only after qualification. The subsequent authenticated live probe qualifies the tested Ethereum standard-read shape and sample routing behavior, but it does not broaden that evidence to writes or untested method families.

Known limitations:

- Authenticated behavior was tested only for Ethereum standard reads; no live write, trace/debug method, batch, or archive-depth boundary was exercised.
- Deterministic mocks prove routing invariants, not production reliability or full method semantics.
- The optional public endpoint smoke proves only a basic keyless Ethereum response.
- The fixture exercises viem in a trusted Node.js runtime; browser-only, other-client, enhanced API, webhook, and non-EVM adaptations still require project-specific evaluation.
- WebSocket subscriptions remain partial migrations until the application retains the legacy path deliberately or adopts a supported polling design.
- The SolidRPC website CTAs and public/plugin distribution remain unchanged pending review.
