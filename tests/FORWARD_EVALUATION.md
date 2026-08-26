# Forward evaluation report

Release: `v0.1.1`

Date: 2026-08-26

This report records independent skill runs, deterministic sample tests, authenticated read-only
qualification, and Codex/Claude plugin checks for `migrate-to-solidrpc`. Credentials are never
included. Qualification evidence from these runs applies only to the tested fixture or sample
configuration and must not be reused for another application.

## Source fixture

Each independent agent received a fresh isolated copy of
`tests/fixtures/viem-app-before` plus the release skill. The untouched TypeScript/viem fixture has:

- portable HTTPS reads through `PRIMARY_RPC_URL`;
- signed raw-transaction submission through that provider;
- an independent WebSocket subscription through `PRIMARY_WS_URL`;
- deterministic JSON-RPC mocks on ephemeral ports; and
- three passing baseline tests.

The fixture in this repository was not modified. Its clean installation, type check, and 3/3
tests passed.

## Independent Codex forward runs

### Default add mode

- Request: `Add SolidRPC to this application.`
- Isolated workspace: `/private/tmp/migrate-v011-add-eval.IfDUtA`
- Baseline commit: `63cd946`
- Result: passed.

The agent left `src/provider.ts`, `src/config.ts`, and `src/index.ts` unchanged. Production HTTPS
reads, signed writes, and WebSocket subscriptions remain exclusively on the existing provider. It
added one manually invoked, fixed-allowlist comparison path using the clean chain-1 endpoint and
`X-API-Key`; no fallback, runtime selector, background mirror, or write path reaches SolidRPC.

Changed files:

- `.env.example`, `.gitignore`, `README.md`, `package.json`, and
  `test/provider.test.ts`;
- new `src/compare.ts`, `src/comparison.ts`, and `SOLIDRPC_MIGRATION.md`.

Evidence:

- The live catalog was fetched at `2026-08-26T18:42:06Z`; it returned 57 entries and listed
  Ethereum chain 1 as `live` with `full`/`archive` and `standard`/`trace`/`debug`.
- Normal tests recorded two legacy production reads and zero SolidRPC production reads. The write
  fixture reached the legacy provider once and SolidRPC zero times.
- A successful manual mock comparison made three legacy reads and two SolidRPC reads after one
  catalog fetch. Missing credentials or unsupported coverage stopped before either RPC provider.
- The migration record left batch size, expanded traffic, quota-window demand, shared traffic,
  retry amplification, and headroom explicitly unmeasured. It recorded zero authenticated live
  probes instead of inventing capacity evidence.
- `npm ci`, type checking, 8/8 tests, diff checking, environment-file review, and credential-pattern
  scanning passed with zero audit vulnerabilities.

### Explicit replace mode without qualification inputs

- Request: replace the main provider and use SolidRPC as the only compatible HTTPS JSON-RPC route.
- Isolated workspace: `/private/tmp/migrate-v011-replace-eval.dZuCcg`
- Result: safely blocked.

The same live catalog passed at `2026-08-26T18:42:11.724Z`, but no intended production credential
or measured capacity profile was available. The agent therefore left the active HTTPS, write, and
WebSocket routes unchanged. It added only inactive candidate configuration using the clean
endpoint; the executable neither imports nor constructs the candidate client.

Changed files:

- `.env.example`, `.gitignore`, `README.md`, `src/provider.ts`, and
  `test/provider.test.ts`;
- new `src/solidrpc.ts` and `SOLIDRPC_MIGRATION.md`.

Evidence:

- Credential qualification made zero authenticated JSON-RPC probes.
- Effective rate, burst, quota, remaining capacity, batch-expanded demand, retry amplification,
  shared traffic, and headroom were all recorded as blocked rather than inferred from a plan.
- Across the suite, the existing provider received five HTTP calls and SolidRPC received zero.
  Successful and ambiguous-HTTP transaction tests each submitted exactly once with retries
  disabled.
- WebSocket/`eth_subscribe` remained exclusively on `PRIMARY_WS_URL` as a partial-migration
  boundary.
- `npm ci`, type checking, 6/6 tests, diff checking, environment-file review, and credential-pattern
  scanning passed with zero audit vulnerabilities.

These two runs show that ordinary migration language selects add mode, while explicit replacement
cannot bypass missing credential or capacity evidence.

## Release sample behavior

The completed sample in `examples/viem-app` has separate entrypoints:

- `npm run app` is permanently wired to the legacy provider.
- `npm run rpc:compare` validates the live catalog, then makes a manual three-call SolidRPC stable
  read comparison. It does not require a capacity profile and cannot change routing.
- `npm run rpc:qualify` validates the catalog, makes one authenticated `eth_chainId` capacity
  probe, evaluates measured demand against live limit/quota headers, performs the comparison, and
  atomically writes HMAC-protected evidence only on success.
- `npm run app:solidrpc` is a partial read-replacement entrypoint. It requires the credential plus
  unexpired schema-v2 evidence bound to the chain, endpoints, address, credentials,
  authentication shape, capacity profile, and
  `viem-sample-partial-read-routing-invariants-v3` check. Qualified reads use SolidRPC only;
  `eth_sendRawTransaction` remains explicitly legacy until write scope is separately proven.

The 39 deterministic sample tests passed. They cover:

- legacy-only default routing and catalog-before-comparison ordering;
- unavailable/malformed catalog, unsupported chain, missing credential, and missing capacity;
- stable block/hash comparison with the legacy result remaining authoritative;
- coherent authenticated `X-RateLimit-*` and `X-Quota-*` parsing, day/month window selection,
  insufficient quota or remaining-window headroom, insufficient burst, missing headers, and
  wrong-chain responses;
- explicit demand for valid-method batch size, sustained/peak method calls, shared traffic, retry
  amplification, quota-window units, and headroom;
- schema-v2 evidence expiry at the earliest of its TTL, live quota reset, and delegated-JWT `exp`
  minus safety skew, plus HMAC rejection of shape-valid payload edits;
- preferred `X-API-Key`, constrained Bearer API-key fallback, customer-JWT coexistence, and
  duplicate URL/header transport rejection, with evidence invalidation after key or JWT rotation;
- recoverable authenticated 429, non-retryable oversized batch even with contradictory
  `Retry-After`, authenticated 402, HTTP-200 JSON-RPC errors, and public 429/JSON-RPC `-32005`
  classification;
- percent-encoded duplicate URL credentials, official public/demo alias rejection, and sanitized
  command failures; and
- SolidRPC-only qualified reads plus exactly-once retained-legacy writes with no cross-provider
  retry or shadow.

A successful comparison records three SolidRPC method calls. A successful partial read
qualification records four calls/response units: one capacity probe plus the three comparison
calls. The sample refuses a boolean-only overage assertion; capacity beyond returned headers needs
separately approved and account-verified evidence before adapting the gate.

## Authenticated final-flow probe

An owner-provided temporary credential exercised the final v0.1.1 entrypoints. The key was read
without terminal echo into a short-lived process environment, sent only through `X-API-Key` to the
clean endpoint, and never placed in a command line, file, URL, report, or repository output.

At `2026-08-26T19:24:28Z`:

- the live catalog qualified Ethereum chain 1 with `standard` coverage;
- the authenticated response supplied all required rate, burst, quota-window, usage, remaining,
  and reset headers;
- a deliberately bounded evaluation profile passed the capacity calculation;
- an external existing provider and SolidRPC returned the same canonical hash and balance at
  block `25841447`;
- `rpc:qualify` wrote secret-free, HMAC-protected schema-v2 evidence for four calls/response units;
  and
- `app:solidrpc` accepted that evidence and completed a SolidRPC-labeled balance read while naming
  `eth_sendRawTransaction` as retained legacy behavior.

The evaluation profile used a one-method largest batch, 0.1 sustained and 1 peak method call per
second, 3,000 monthly units, no shared traffic, no retry amplification, and 20 percent headroom.
Those illustrative inputs are not a production traffic measurement. The live run qualifies only
that sample invocation, not another application, a production workload, or transaction
submission. An API-key-pattern scan of the ignored evidence file passed.

## Claude Code compatibility

The Codex and Claude packages share the same `SKILL.md` and references. Claude-specific files are
limited to `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; explicit invocation
is `/migrate-to-solidrpc:migrate-to-solidrpc`.

Validated with Claude Code 2.1.224:

- `claude plugin validate --strict .`: passed.
- `claude --plugin-dir . plugin details migrate-to-solidrpc`: discovered version 0.1.1 and exactly
  one skill.
- An isolated local marketplace add/install resolved enabled
  `migrate-to-solidrpc@solidrpc` version 0.1.1.

A full model-driven fixture run was attempted through the plugin. Claude Code stopped before
processing the prompt because its local OAuth session was expired and no Anthropic API key was
configured. The disposable target project was not changed. This release therefore claims Claude
manifest, installation, and discovery compatibility, but not a completed Claude model-behavior
evaluation.

## Repository validation

Release checks:

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

- Bundled skill and Codex plugin validation passed.
- Claude strict manifest/marketplace validation and isolated local installation passed.
- Release metadata, matching 0.1.1 versions, tag-name binding, Markdown links, license, security,
  environment files, whitespace, and secret rules passed.
- The sample passed a clean install, zero audit vulnerabilities, type checking, and 39/39 tests.
- The untouched fixture passed a clean install, zero audit vulnerabilities, type checking, and
  3/3 tests.
- Working-tree and reachable-history credential-pattern scans passed without printing suspected
  values.
- Node.js 24.4.1 was used locally; both projects declare ranges compatible with the Node.js 22 CI
  matrix.

## Conclusions and limitations

Version 0.1.1 adds the missing fail-closed capacity gate, runtime limit/error semantics, constrained
Bearer compatibility, authenticated evidence integrity, JWT-bounded expiry, and capacity-bound
evidence while preserving default-mode isolation and exactly-once writes. The sample explicitly
models partial read replacement: its live-qualified read route is SolidRPC-only, while its
unqualified transaction route remains legacy. The final authenticated sample flow removes reliance
on the superseded pre-hardening runtime-switch probe.

Known limitations:

- The live authenticated run covered Ethereum standard reads only. It did not submit a live
  transaction or exercise trace/debug, batches, deep archive boundaries, or upstream failure.
- Deterministic mocks prove routing and evidence invariants, not SolidRPC availability or every
  JSON-RPC method/parameter combination.
- WebSocket subscriptions remain an explicit partial-migration boundary.
- Browser clients, enhanced APIs, webhooks, other client libraries, and non-EVM protocols require
  project-specific qualification.
- A completed authenticated Claude model-driven migration remains outstanding.
