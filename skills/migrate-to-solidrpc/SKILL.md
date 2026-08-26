---
name: migrate-to-solidrpc
description: Safely add SolidRPC to an EVM application or explicitly replace its current RPC provider. Use when integrating, evaluating, migrating, or cutting an application over to SolidRPC; default to a manual comparison path that leaves production routing unchanged.
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
- fallback, retry, load-balancing, health-check, and failover behavior.

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
hardcoded network list. Treat a failed, malformed, stale, or insufficient catalogue check as
unverified coverage.

Preserve the application's current client library and public interfaces. Prefer
`https://rpc.solidrpc.io/evm/{chainId}` with `X-API-Key` on trusted server-side clients.
Use URL authentication only when a trusted-runtime client accepts an RPC URL but cannot set
headers. Never ask the user to paste a key into chat, source, commands, logs, or reports;
wire the existing secret mechanism, defaulting to `SOLIDRPC_API_KEY` only when the project
has no convention.

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
requested and effective mode, catalogue evidence, coverage gaps, route ownership,
validation, rollback, and remaining actions. Never include credentials or full
credential-bearing URLs.

Conclude with what changed, what traffic is active on each provider, tests run, and any
blocked or incompatible behavior. In add mode, explicitly state that SolidRPC receives no
production traffic.
