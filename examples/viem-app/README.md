# viem migration example

This server-side TypeScript app demonstrates a fail-closed SolidRPC migration. The normal
`app` entrypoint is permanently wired to the existing provider. There is no environment
variable that can accidentally cut over production traffic.

## Configure

```sh
npm ci
cp .env.example .env
```

Set `LEGACY_RPC_URL`, `SOLIDRPC_API_KEY`, `CHAIN_ID`, and `ACCOUNT_ADDRESS`. The
SolidRPC client uses the clean `https://rpc.solidrpc.io/evm/{chainId}` endpoint and sends
the key in `X-API-Key`. Do not put the key in a URL, source file, report, or committed
environment file.

## Default and comparison paths

```sh
npm run app
npm run rpc:compare
```

`npm run app` performs a normal balance read through the legacy provider only. It does
not fetch the SolidRPC catalog or contact SolidRPC.

`npm run rpc:compare` is a manual, read-only path. Before either provider is contacted,
it fetches `https://api.solidrpc.io/networks` and requires the configured chain to be
live with the `standard` method family. It then resolves a shared confirmed block,
verifies the canonical block hash, and compares balances at that exact block. A mismatch
or incomparable result exits with status 2 and never changes the production result.

## Qualify and exercise replacement

Replacement has a separate entrypoint and requires fresh durable evidence:

```sh
npm run rpc:qualify
npm run app:solidrpc
```

`rpc:qualify` performs the catalog check and authenticated stable-block comparison. It
writes `.solidrpc/qualification.json` only when the results match. The ignored evidence
file contains no API key or legacy URL. It is bound to the chain, endpoint configuration,
comparison address, catalog endpoint, and qualification lifetime; the sample defaults to
a maximum lifetime of 24 hours. It also records
`viem-sample-routing-invariants-v1` as a required release check. That identifier means the
routing-invariant suite is required before release; it does not claim that generating the
evidence ran `npm test` or that an arbitrary local test invocation passed.

`app:solidrpc` fails closed when evidence is missing, malformed, expired, or does not
match the current configuration. With valid evidence, portable HTTPS traffic goes only
to SolidRPC. The legacy URL remains in configuration for manual rollback but is not
registered as a fallback and is never contacted by this entrypoint.

The exported transaction methods submit an already-signed raw transaction exactly once
to their active route. Comparison and qualification never submit, mirror, retry, or
shadow writes. This sample does not migrate WebSockets, `eth_subscribe`, browser-held
credentials, deep archive access, trace/debug calls, or provider-specific APIs; those
need their own qualification or must stay on their existing path.

## Verify

```sh
npm run typecheck
npm test
```

Tests use ephemeral local catalog and JSON-RPC servers. They cover default isolation,
catalog failure and malformed data, unsupported chains, stable comparison, qualification
evidence gates, SolidRPC-only replacement with an unreachable legacy endpoint, and
exactly-once transaction submission. Mocks demonstrate routing invariants, not production
service qualification.
