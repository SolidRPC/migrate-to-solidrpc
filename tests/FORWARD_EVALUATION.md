# Forward evaluation report

Release: `v0.1.0`

Date: 2026-08-26

This report records release-stage tests of the shared `migrate-to-solidrpc` skill, the
artifact-gated viem example, and its Codex and Claude Code plugin packaging. No evaluator
received a real credential. An earlier authenticated read-only probe is retained separately
and explicitly limited below.

## Source fixture

Each independent agent received a fresh copy of `tests/fixtures/viem-app-before` and the
release skill path. The fixture is a Node.js TypeScript application using viem 2.55.19 with:

- portable HTTPS reads through `PRIMARY_RPC_URL`;
- signed raw-transaction submission through that provider;
- an independent WebSocket block subscription through `PRIMARY_WS_URL`;
- deterministic JSON-RPC mocks on ephemeral ports; and
- three passing baseline tests.

The fixture was not changed in this repository. Its clean install, type check, and 3/3 tests
passed before and after the evaluations.

## Independent Codex forward runs

### Default add mode

- Request: `Add SolidRPC to this application.`
- Isolated workspace: `/private/tmp/migrate-v010-codex-add.CnkLQn`
- Result: passed.

The agent preserved the production HTTPS, write, and WebSocket routes. It added a separately
invoked `compare:solidrpc` command with a fixed read allowlist. The command fetches the live
catalog, resolves the existing provider's finalized block, verifies both providers return the
same canonical hash at the exact block number, and compares `eth_getBalance`. A mismatch is
reported while the existing-provider value remains authoritative.

Resulting diff:

- Modified `.env.example`, `README.md`, `package.json`, and `src/config.ts`.
- Added `.gitignore`, `SOLIDRPC_MIGRATION.md`, `src/compare-solidrpc.ts`,
  `src/solidrpc-comparison.ts`, and `test/solidrpc-comparison.test.ts`.
- Production provider construction and the WebSocket implementation were unchanged.

Evidence:

- Live catalog fetch at `2026-08-26T09:16:53.315Z`: chain 1 was `live` with `full` and
  `archive` node types and `standard`, `trace`, and `debug` families.
- `npm run typecheck`: passed.
- `npm test`: passed, 2 files and 10 tests.
- Normal reads and writes reached only the existing provider; SolidRPC received no production,
  fallback, mirror, background, or write traffic.
- The manual comparison used the clean endpoint with `X-API-Key`, disabled retries, and exposed
  no arbitrary RPC method input.
- No credential was available. The missing-key CLI check failed with a value-free error, and no
  authenticated comparison was claimed.

### Explicit replace mode without a credential

- Request: replace the current main provider with SolidRPC and preserve the WebSocket path only
  where incompatible.
- Isolated workspace: `/private/tmp/migrate-v010-codex-replace.H9JZ5M`
- Result: safely blocked.

The agent prepared an inactive SolidRPC client but left the executable wired to the existing
provider because authenticated representative probes could not run. It added no runtime provider
selector or automatic fallback. The eventual qualified result is explicitly described as a
partial replacement: SolidRPC owns compatible HTTPS traffic, while the legacy route remains active
only for WebSocket subscriptions.

Resulting diff:

- Modified `.env.example`, `.gitignore`, `README.md`, `src/config.ts`, `src/provider.ts`, and
  `test/provider.test.ts`.
- Added `SOLIDRPC_MIGRATION.md`.
- `src/index.ts`, the active provider selection, and the WebSocket implementation were unchanged.

Evidence:

- Live catalog fetch at `2026-08-26T09:12:18.068Z`: chain 1 was `live` with the required
  `standard` family and `full` coverage.
- `npm run typecheck`: passed.
- `npm test`: passed, 7/7 tests.
- Existing-provider reads and exactly-once writes remained active; SolidRPC received zero
  production requests.
- Deterministic tests proved both prepared providers submit a signed transaction once with
  `retryCount: 0`, including an ambiguous HTTP failure.
- The prepared SolidRPC client used the clean endpoint with `X-API-Key` and was constructed only
  by tests.
- Missing credential, authenticated stable-read behavior, intended-runtime deployment, direct
  source cutover, and zero-legacy-HTTPS tests remained blocked gates.

These outcomes demonstrate that the same skill interprets an ordinary “add” request as add mode
and an explicit replacement request as replace mode without allowing the latter to bypass failed
qualification gates.

## Release sample qualification tests

The completed sample in `examples/viem-app` is deliberately stricter than a provider-name runtime
switch:

- `npm run app` is hard-wired to the legacy provider.
- `npm run rpc:compare` fetches and validates the live catalog before either RPC provider receives
  comparison traffic.
- `npm run rpc:qualify` performs the catalog check and authenticated stable-block/hash comparison,
  then atomically writes ignored, non-secret evidence only on a matching result.
- `npm run app:solidrpc` requires a credential plus unexpired evidence bound to replace mode, chain,
  clean endpoint, catalog endpoint, comparison address, configuration fingerprint, and the
  `viem-sample-routing-invariants-v1` release-check identifier.
- Evidence generation never changes routing and never sends a write.

The sample's 13 deterministic tests passed. They prove:

- default reads and writes are legacy-only;
- manual comparison validates the catalog first and leaves the legacy result authoritative;
- catalog outage, malformed data, missing chain, and missing credential stop before RPC traffic;
- mismatch or canonical-block disagreement cannot create evidence;
- missing, malformed, expired, wrong-chain, wrong-endpoint, wrong-mode, wrong-address, and tampered
  routing-check evidence cannot activate replacement;
- valid evidence allows portable reads only through SolidRPC even when the legacy endpoint is
  unreachable; and
- default and qualified signed transactions each reach their one active provider exactly once.

The sample's live catalog parser was also run against `https://api.solidrpc.io/networks` at
`2026-08-26T09:20:32.585Z`. It selected Ethereum chain 1 as `live` with `full`/`archive` and
`standard`/`trace`/`debug`. This validates current discovery parsing only; it is not authenticated
RPC qualification.

## Claude Code compatibility

The release uses the same `skills/migrate-to-solidrpc/SKILL.md` and references for both hosts.
Claude-specific packaging is limited to `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`; the explicit invocation is
`/migrate-to-solidrpc:migrate-to-solidrpc`.

Validated with Claude Code 2.1.224:

- `claude plugin validate --strict .`: passed.
- `claude --plugin-dir . plugin details migrate-to-solidrpc`: discovered version 0.1.0 and exactly
  one skill.
- An isolated local marketplace add and install resolved `migrate-to-solidrpc@solidrpc` version
  0.1.0.

A full Claude model-driven fixture migration was attempted through `--plugin-dir`, but Claude Code
stopped before processing the prompt because the local OAuth session was expired and no Anthropic
API key was configured. No target-project change occurred. Therefore this release claims Claude
Code manifest, marketplace, installation, and discovery compatibility; it does not claim a
completed Claude model-behavior evaluation. The shared instructions themselves were independently
exercised by the two Codex runs above.

## Earlier authenticated read-only probe

An owner-provided temporary credential was used before the release hardening for a sanitized,
read-only Ethereum probe. It was inherited in memory by the probe process, sent only as an
`X-API-Key` header to the clean endpoint, and never placed in a command line, file, URL, report, or
repository output.

At `2026-08-26T08:19:00Z`, the live catalog qualified chain 1 and an independent public existing
provider and SolidRPC returned the same canonical block hash and balance at block `25838127`. A
SolidRPC-only read also succeeded with the legacy URL deliberately unreachable. No transaction,
signing request, trace/debug call, archive-depth boundary, WebSocket request, or state-changing
method was sent.

That pre-release sample used the now-removed `RPC_PRIMARY` switch. Its endpoint/authentication and
stable-read result remains useful integration evidence, but it is not qualification evidence for
the v0.1.0 artifact-gated replacement entrypoint. The release's durable-evidence behavior is proven
by the deterministic tests above. Secret-pattern scans of the current tree and complete Git history
found no API-key-shaped value.

## Repository validation

Release checks run locally:

```text
python3 <skill-creator>/scripts/quick_validate.py skills/migrate-to-solidrpc
python3 <plugin-creator>/scripts/validate_plugin.py .
claude plugin validate --strict .
python3 scripts/validate_release.py
cd examples/viem-app && npm ci && npm run typecheck && npm test
cd tests/fixtures/viem-app-before && npm ci && npm run typecheck && npm test
git diff --check
```

Outcomes:

- Bundled skill validation: passed.
- Bundled Codex plugin validation: passed.
- Claude strict plugin/marketplace validation: passed.
- Offline release metadata, path, Markdown-link, license, security, environment-file, whitespace,
  and secret validation: passed.
- Migrated sample: clean install, zero reported vulnerabilities, type checking, and 13/13 tests
  passed.
- Untouched fixture: clean install, zero reported vulnerabilities, type checking, and 3/3 tests
  passed.
- Working-tree and complete-history secret-pattern scans: passed without printing suspected values.
- Local Node.js execution used 24.4.1. Both projects declare ranges compatible with Node.js 22, and
  CI executes the same install/typecheck/test matrix on Node.js 22.

## Conclusions and limitations

The release removes the unqualified runtime cutover path, validates the live catalog in the sample
comparison, requires durable matching evidence for the sample's SolidRPC-only entrypoint, packages
one shared skill for Codex and Claude Code, and fails safely across the tested routing and evidence
gates.

Known limitations:

- Live authenticated behavior was exercised only for Ethereum standard reads before the final
  artifact-gated redesign; no live write, trace/debug, batch, or archive-depth boundary was tested.
- Deterministic mocks prove routing invariants, not SolidRPC availability or every JSON-RPC method
  and parameter combination.
- The sample check identifier is release metadata, not a cryptographic attestation that a local
  operator ran `npm test`; CI and deployment controls must enforce project checks.
- WebSocket subscriptions remain an explicit partial-migration boundary.
- Browser-only clients, other RPC libraries, enhanced APIs, webhooks, and non-EVM protocols require
  project-specific inventory and qualification.
- A full authenticated Claude model run remains outstanding because the local Claude Code session
  was not authenticated during release testing.
