# Forward evaluation report

Release: `v0.1.3`

Date: 2026-08-27

This report records the deterministic migration suite, an independent Codex skill run, and
local package installation and discovery in Codex and Claude Code. No credential value is
included or was made available to the evaluation agents.

## Evaluation fixture

The pre-migration TypeScript/viem fixture represents a production application with:

- compatible HTTPS reads and signed transaction submission through `PRIMARY_RPC_URL`;
- a WebSocket subscription through `PRIMARY_WS_URL`;
- an `alchemy_getTokenBalances` provider-specific call;
- retries disabled for ambiguous signed-transaction responses; and
- discoverable production traffic facts in `monitoring/rpc-traffic.json`.

The evidence source contains peak and sustained request rates, quota-window usage, shared
usage, largest batch, concurrency, required network and method family, oldest required block,
timeouts, retry behavior, capacity headroom, and the never-retry write policy. Its clean
installation, type check, and 5/5 baseline tests passed.

## Independent Codex migration run

Codex CLI 0.149.0-alpha.4 received a fresh Git copy of the fixture and the release skill. The
request explicitly identified the application as production, named `SOLIDRPC_API_KEY` as the
secret reference, stated that no credential value was available, and requested every safe local
change without deployment, commit, push, or production mutation.

The agent:

- inferred and used the existing production telemetry before reporting missing gates;
- attempted the required live catalogue request, which failed because that isolated Codex
  execution had no DNS/network access;
- prepared a six-file review-only diff rather than stopping at inventory;
- replaced compatible HTTPS reads and signed writes with one viem transport to the clean
  SolidRPC chain-1 endpoint using `X-API-Key` and retries disabled;
- retained WebSocket and provider-specific calls as named incompatible boundaries that cannot
  catch ordinary SolidRPC errors;
- added request-count tests for SolidRPC-only compatible reads, exactly-once writes, ambiguous
  write failure, boundary isolation, and the secret-reference error; and
- created no HMAC, runtime qualification file, startup gate, selector, fallback pool, or
  `SOLIDRPC_MIGRATION.md`.

`npm run typecheck`, 6/6 migrated-fixture tests, and `git diff --check` passed. The final response
was secret-free, included the diff size and Git rollback, and correctly marked the change **not
deployment-ready**. It consolidated the remaining production gates into one blocker list: live
catalogue coverage, authenticated stable/history smoke, account rate/burst/batch/quota limits,
and write authorization. No external or production state changed.

This forward run proves the direct-change and blocked-production behavior under a real Codex
agent. It does not qualify a production deployment because authenticated service evidence was
intentionally unavailable.

## Deterministic release sample

The canonical post-migration sample in `examples/viem-app` has one normal application command and
one read-only prototype smoke command. Compatible reads and writes use a single SolidRPC HTTPS
transport. The default application contains no legacy HTTP route, provider selector, comparison
fanout, automatic fallback, migration report, signed evidence, or startup gate. The optional
advanced-evidence example is isolated from normal imports and scripts.

The sample passed type checking, build, and 14/14 tests covering every requested invariant:

1. a prototype without historical telemetry completes through the authenticated fast path;
2. production telemetry is discovered automatically;
3. missing production inputs produce one consolidated question;
4. default migration uses no HMAC or runtime qualification artifact;
5. default migration creates no `SOLIDRPC_MIGRATION.md`;
6. expired, edited, missing, or invalid advanced evidence leaves the rollback route operational;
7. transactions and state-changing calls are sent exactly once, including ambiguous failure;
8. WebSocket and provider-specific routes remain explicit boundaries;
9. summaries and request errors are secret-free;
10. compatible reads and writes reach only SolidRPC;
11. a blocked production cutover leaves application and production state unchanged;
12. an explicit prototype setting above an observed plan limit blocks while unknown traffic does
    not;
13. unclear production status produces one concise classification question; and
14. live-catalogue coverage, authenticated read-only smoke, and applicable plan-limit display are
    exercised against deterministic local servers.

Mocks establish request counts and policy behavior; they do not prove live service availability,
account policy, or production capacity.

## Codex packaging

An isolated Codex configuration added this repository as a local marketplace and installed
`migrate-to-solidrpc@solidrpc`. Codex resolved version 0.1.3, enabled the plugin, and exposed the
single `migrate-to-solidrpc` skill from the package. The skill and Codex plugin validators passed.

The remote `v0.1.3` tag did not exist while this report was authored. Installation from that exact
remote tag remains a release-time gate and must be reported after the tag is published; this
report does not present a local source install as a tagged install.

## Claude Code packaging

Claude Code 2.1.224 passed strict marketplace validation. In an isolated configuration, it added
the local marketplace, installed enabled `migrate-to-solidrpc@solidrpc` version 0.1.3, and reported
exactly one discovered skill named `migrate-to-solidrpc` with no agents, hooks, MCP servers, or LSP
servers.

The host supports the documented `owner/repository@tag` marketplace-source syntax. The exact
remote tag install remains the same release-time gate as Codex. A model-driven Claude migration
was not run because `claude auth status` reported `loggedIn: false`; installation, validation, and
skill discovery are verified, but Claude model behavior is not claimed end to end.

## Live service checks

The unauthenticated public network catalogue was reachable from the release shell and returned a
JSON array with 57 entries; Ethereum chain 1 was `live` with `standard`, `trace`, and `debug`
families and full/archive node types. The isolated Codex sandbox could not resolve that host, and
no authenticated SolidRPC credential reference was injected into the release environment.

Therefore no authenticated live RPC smoke, plan-header observation, live historical read, write
authorization check, or transaction submission was performed for this release. The release makes
no production-capacity or production-qualification claim.

## Validation commands and outcomes

```text
python3 <skill-creator>/scripts/quick_validate.py skills/migrate-to-solidrpc
python3 <plugin-creator>/scripts/validate_plugin.py .
claude plugin validate --strict .
python3 scripts/validate_release.py
GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v0.1.3 python3 scripts/validate_release.py
cd examples/viem-app && npm ci && npm run typecheck && npm run build && npm test
cd tests/fixtures/viem-app-before && npm ci && npm run typecheck && npm test
git diff --check
```

The skill, plugin, and Claude validators passed. The sample passed its clean install, type check,
build, and 14 tests. The pre-migration fixture passed its clean install, type check, and 5 tests.
Release metadata, marketplace data, README, changelog, license, security policy, tag binding,
tracked environment files, and secret/history rules are enforced by `validate_release.py`.

## Known limitations

- The prototype completion path is proven with deterministic authenticated mocks, not a live API
  key.
- The independent production run prepared a tested local cutover diff but correctly blocked
  deployment qualification.
- Claude installation and discovery are verified, but a Claude model did not execute the skill.
- WebSockets, subscriptions, browser-held credentials, webhooks, non-EVM protocols, and
  provider-specific APIs require explicit project-specific decisions.
- The release does not test every client library, JSON-RPC method/parameter combination, deep
  archive boundary, batch shape, or upstream failure mode.
