---
name: migrate-to-solidrpc
description: Safely add SolidRPC to an EVM application or explicitly replace its current RPC provider. Use when integrating, evaluating, migrating, or cutting an application over to SolidRPC; default to a manual comparison path that leaves production routing unchanged.
license: MIT
---

# Migrate to SolidRPC

Migrate the application's RPC integration without turning provider diversity back into the
user's operational burden. Preserve the current client library and make routing behavior
observable and reversible.

## Start with evidence

Before editing, inspect the project and record:

- every provider/client construction site and chain ID;
- read methods, write or signing methods, historical/archive depth, batches, and timeouts;
- HTTP, WebSocket, `eth_subscribe`, webhook, and provider-specific features;
- server/browser boundaries, environment-variable names, secret injection, and tests;
- fallback, retry, load-balancing, health-check, and failover behavior;
- the largest valid-method batch, sustained and peak RPC method calls per second after
  expanding batches, and projected response units in the actual quota window; and
- aggregate traffic sharing the account, key, or delegated JWT, including retry
  amplification and the lowest applicable limits.

Do not read secret-bearing environment files or print secret values. Use file names,
examples, schemas, and code references to inventory configuration.

Read [the integration contract](references/integration-contract.md) before qualifying
coverage. Read [migration modes and gates](references/migration-modes.md) before changing
routing. Read [client adaptation](references/client-adaptation.md) when modifying provider
construction or authentication.

## Choose the mode

Use **add mode** unless the user explicitly asks to replace, cut over, or make SolidRPC the
primary/only provider.

- **Add mode:** leave every production request on the existing route. Add SolidRPC
  configuration and a separately invoked, read-only comparison command or diagnostic.
  Never add automatic fallback, request fanout, background mirroring, or production-path
  shadow traffic.
- **Replace mode:** after all qualification gates pass, make SolidRPC the sole active route
  for portable HTTPS JSON-RPC. Retain the legacy configuration inactive for rollback. A
  legacy provider may remain active only for an inventoried incompatible feature such as
  WebSocket subscriptions or a proprietary API; label this as a partial migration.

Prefer an explicit code or deployment-config cutover after qualification. If a reusable sample
or operational workflow must keep both routes selectable, require generated, durable
qualification evidence before SolidRPC can become active; a provider-name environment variable
or other bare switch is never sufficient.

If replace mode was requested but a gate fails, prepare safe wiring only, keep the existing
production route active, and report the cutover as blocked. Do not quietly downgrade the
requested mode or claim completion.

## Implement safely

Fetch `https://api.solidrpc.io/networks` during this migration. Never use a remembered or
hardcoded network list. Treat a failed, malformed, or insufficient current-run catalogue check
as unverified coverage. Treat expired durable evidence as unqualified.

Preserve the application's current client library and public interfaces. Prefer
`https://rpc.solidrpc.io/evm/{chainId}` with `X-API-Key` on trusted server-side clients.
Use an API key as `Authorization: Bearer` only on a trusted client that can set that header but
cannot set `X-API-Key`, and only when `Authorization` is not already needed and no customer JWT
is required. Use URL authentication last, only when a trusted-runtime client accepts an RPC URL
but cannot set headers. Configure exactly one API-key transport. Never ask the user to paste a
key into chat, source, commands, logs, or reports; wire the existing secret mechanism, defaulting
to `SOLIDRPC_API_KEY` only when the project has no convention.

Before replacement, qualify capacity from authenticated response headers and measured
application demand. Never hardcode public plan values. Require deliberate headroom and block
cutover when the effective rate, burst, or quota is insufficient unless an upgrade or overage
path is explicitly approved and verified. Record qualification probe usage as part of the
capacity evidence.

Qualify authentication scope as well as capacity. Read-only probes cannot authorize a write
cutover. Move a transaction path only when the intended production credential and account policy
are verified for that method and exactly-once tests pass. Otherwise retain that named write route,
label the result partial, and never use it as fallback for a SolidRPC read.

If durable evidence controls activation, protect the complete payload against edits with an
authenticated integrity mechanism such as HMAC keyed by the intended API key; a plain credential
fingerprint is only a binding, not integrity protection. Invalidate evidence on credential
rotation. When a delegated JWT is required, validate its expiry and end qualification before
`exp` with a documented safety margin.

In add mode, compare only explicitly classified read-only calls and only after manual
invocation. Resolve moving tags to a stable block number or hash first. Never replay,
mirror, retry across providers, or otherwise duplicate a transaction, signing request, or
unknown method. The existing provider's result remains the application's result.

Adapt tests to prove the selected routing behavior. Use mocks for deterministic request
counts and failures; do not mistake mocks or a public/keyless smoke test for production
qualification.

## Leave a durable record

Create or update `SOLIDRPC_MIGRATION.md` at the target project root using the required
structure in [migration modes and gates](references/migration-modes.md). Include inventory,
requested and effective mode, catalogue and capacity evidence, coverage gaps, route ownership,
validation, rollback, and remaining actions. Never include credentials or full
credential-bearing URLs.

Conclude with what changed, what traffic is active on each provider, tests run, and any
blocked or incompatible behavior. In add mode, explicitly state that SolidRPC receives no
production traffic.
