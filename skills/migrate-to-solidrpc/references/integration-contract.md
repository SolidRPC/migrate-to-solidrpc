# SolidRPC integration contract

Use this contract to qualify and implement the migration. Fetch service-owned discovery
data during the current migration; never copy a remembered network list into the project.

## Endpoint and authentication

- Portable JSON-RPC uses HTTPS POST to
  `https://rpc.solidrpc.io/evm/{decimalChainId}`.
- On a trusted server-side client, prefer `X-API-Key` with the clean endpoint.
- If a trusted client cannot set `X-API-Key` but supports `Authorization`, it may use
  `Authorization: Bearer <apiKey>` only when that header is otherwise unused and no
  customer JWT is required.
- Use `https://rpc.solidrpc.io/{apiKey}/evm/{decimalChainId}` only for a trusted-runtime,
  string-only client. Construct it in memory; never display or persist the resulting URL.
- Configure exactly one API-key transport. SolidRPC does not expose WebSocket JSON-RPC or
  support `eth_subscribe`.

Keep the credential in the project's existing secret mechanism. Default to the name
`SOLIDRPC_API_KEY` only when the project has no convention. Never open secret-bearing
environment files, inspect a secret value, interpolate it into a displayed command, or put
it in source, logs, diffs, reports, shell history, or a stored or displayed URL. The
string-only-client exception above must construct its credential-bearing URL only in
memory. Ask for a secret-reference or environment-variable name, not a value. Run
authenticated probes through code that consumes the already-injected secret without
emitting it.

A browser bundle cannot keep an API key secret. Reuse an existing trusted backend or proxy.
If the request does not include adding such a boundary, leave the browser route as an
explicit unresolved migration boundary.

## Live catalogue coverage

Fetch `https://api.solidrpc.io/networks` with an unauthenticated HTTPS GET during the
migration. Require a successful JSON array and find every network by numeric `chainId`, not
array position. Verify:

- `status` is `live`;
- `nodeTypes` includes `archive` when the application needs deep historical state or logs;
- `methods` contains every required advertised family.

Treat ordinary portable EVM JSON-RPC as `standard`, `trace_*` as `trace`, and read-only
`debug_*` as `debug`. Inventory actual block numbers, hashes, and log ranges: method names
alone do not reveal archive needs. A family advertisement is not proof of every parameter
shape, so smoke-test business-critical trace, debug, batch, and oldest-history reads.

Unavailable, malformed, non-live, or insufficient catalogue coverage blocks that route.
Do not silently send it to a legacy HTTP fallback.

## Authenticated smoke tests and plan limits

Use minimal read-only calls in the intended trusted runtime. Resolve moving tags to a stable
block number or hash and confirm both the expected chain and response shape. Do not claim
write authorization from a read-only probe. A public or keyless call does not prove
authenticated access, account policy, capacity, or production readiness.

Discover the current account's applicable, non-secret plan limits from authenticated
response headers, account metadata already available to the project, or current official
account configuration. Useful response fields include `X-RateLimit-Limit`,
`X-RateLimit-Burst`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Quota-Limit`,
`X-Quota-Remaining`, and `X-Quota-Reset`; obtain a batch limit from current account metadata
when it is not reported in the response. Do not hardcode a public plan or infer limits from
the API key itself. Show the applicable limit values and their source without showing
credentials or complete raw headers.

For a prototype, compare explicit repository settings—batch size, concurrency, polling,
timeouts, worker counts, and configured request budgets—with those limits. Missing
historical traffic measurements is not a blocker. State that production capacity has not
been proven; this warning is advisory unless the repository clearly exceeds an available
limit.

For production, follow the demand and telemetry gates in
[migration workflow and gates](migration-modes.md). Account for each valid method in a
batch, shared account usage, and retry amplification. Treat HTTP 402 as quota-blocked and
HTTP 429 according to its authenticated limit headers and `Retry-After`; do not route either
case to the legacy provider.

## Request classification and exact-once behavior

Classify observed calls individually. Never fan out, compare, hedge, or cross-provider retry:

- `eth_sendRawTransaction`, `eth_sendTransaction`, signing, wallet, account-unlock,
  node/consensus/admin mutations, and other state-changing calls;
- an unknown method whose effects have not been established as read-only; or
- a batch containing any unsafe or unknown member.

After qualification, send an eligible transaction or state-changing call exactly once to
the single SolidRPC route and return that response. An ambiguous timeout must not trigger
another submission. If write scope cannot be safely verified, keep that call site as an
explicit unresolved boundary and do not represent the migration as complete for writes.

Read comparisons, when useful during local validation, must be manual test traffic—not
production shadowing. Resolve a stable reference first, compare JSON-RPC meaning rather
than request IDs or formatting, and sanitize errors.
