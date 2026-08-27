# SolidRPC viem migration sample

This is the canonical post-migration application for `migrate-to-solidrpc` v0.1.3. Its
compatible HTTPS JSON-RPC reads and writes use one authenticated SolidRPC transport.
There is no legacy HTTP provider, provider parameter, runtime selector, comparison fanout,
or customer-managed fallback pool. SolidRPC owns upstream routing, failover, monitoring,
and recovery behind that integration.

## Run the migrated app

```sh
npm ci
cp .env.example .env
npm run rpc:smoke
npm run app
npm run typecheck
npm run build
npm test
```

Set `SOLIDRPC_API_KEY` through the project's secret mechanism. The sample sends it in
`X-API-Key` to the fixed `https://rpc.solidrpc.io/evm/{chainId}` endpoint. It never puts
credentials in a URL, prints them, stores qualification files, or creates a migration
report. Real environment files are ignored.

The transport has retries disabled. A signed transaction or other state-changing request
is sent exactly once. An ambiguous response is reported for reconciliation; the request is
not automatically retried.

## Prototype smoke and plan limits

`npm run rpc:smoke` is a read-only prototype fast path. It fetches the live network catalog,
checks the `standard` method family, performs authenticated `eth_chainId` and
`eth_blockNumber` calls plus an `eth_getBalance` read at a confirmed block, and displays
the non-secret rate, burst, quota, and quota-window limits returned by SolidRPC. It does
not require historical traffic measurements.

The smoke blocks only when an explicit `RPC_MAX_*` repository ceiling exceeds an observed
plan limit. Otherwise it reports `productionCapacityProven: false` as an advisory. That
advisory does not block a prototype, but measured demand must be qualified before a
production deployment.

The pure policy in `src/qualificationPolicy.ts` demonstrates repository classification,
automatic discovery from production evidence sources, one consolidated missing-input
question, and an unchanged route when a production gate is blocked. Migration agents should
discover monitoring, configuration, logs, and infrastructure before asking the user.

## Explicit remaining boundaries

`src/boundaries/` names WebSocket subscriptions and provider-specific APIs as separate
migration decisions. They are not an automatic fallback for compatible SolidRPC traffic.
Browser-held credentials, webhooks, and proprietary APIs require the same explicit handling
in a real repository.

`src/advanced/` is an isolated opt-in dual-route example. Normal scripts and the public
barrel do not import it. Invalid or expired advanced evidence can disable only the SolidRPC
candidate; it cannot disable the existing rollback route.

## Review and rollback

The default migration evidence is the code diff and check output. Deploy through the
project's normal process only after review. Roll back by reverting the migration Git commit
or restoring the pre-migration diff, then run the same normal deployment process. There is
no runtime cutover switch in the normal application.

The deterministic tests cover prototype and production qualification, direct SolidRPC-only
routing, exactly-once ambiguous writes, explicit partial-migration boundaries, secret-free
output, absence of default HMAC/report artifacts, and blocked production state.
