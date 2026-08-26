# SolidRPC integration contract

Use this contract for migration decisions. Re-fetch service-owned discovery data during
each migration rather than copying current catalogue entries into the target project.

## Endpoint and authentication

- JSON-RPC transport is HTTPS POST.
- The clean endpoint is `https://rpc.solidrpc.io/evm/{decimalChainId}`.
- On a trusted server-side client, send the API key in `X-API-Key`. This keeps the key out
  of URLs and leaves `Authorization` available for customer-signed JWTs.
- If a trusted client can set `Authorization` but cannot set `X-API-Key`, it may send the API
  key as `Authorization: Bearer <apiKey>`. Do not use this fallback when the application already
  needs `Authorization` or the key requires a customer JWT.
- If a trusted-runtime client only accepts an RPC URL, it may use
  `https://rpc.solidrpc.io/{apiKey}/evm/{decimalChainId}`. Never render that URL in logs,
  errors, reports, shell history, or committed configuration.
- Use exactly one API-key transport per client: `X-API-Key` first, Bearer only for the constrained
  case above, and URL authentication last for a string-only client. Do not mix transports.
- With header authentication on `rpc.solidrpc.io`, require the exact clean
  `/evm/{decimalChainId}` path. Public/demo aliases, query variants, or encoded alternate paths can
  select a different gateway identity and must never qualify the intended production credential.
- SolidRPC does not expose WebSocket JSON-RPC and does not support `eth_subscribe`.

Keep credentials in the project's established secret mechanism. If none exists, add a
blank `SOLIDRPC_API_KEY` entry to the tracked environment example and ignore real local
environment files. Never ask for, inspect, echo, interpolate into a diagnostic command,
commit, or report the value. The agent checks only whether the intended runtime injects it;
trusted application code may consume it for authentication and a non-reversible evidence binding.

If durable evidence activates replacement, bind it to the intended API key and any delegated JWT
credential without storing either value. Protect the complete canonical evidence payload with an
authenticated integrity mechanism, such as HMAC-SHA256 keyed by the intended API key; a plain
one-way fingerprint does not prevent payload edits. Credential rotation or a change of delegated
scope must invalidate evidence and require requalification. Validate a delegated JWT's `exp` claim
and cap evidence before that instant with a documented clock-skew margin.

A browser-delivered bundle cannot keep an API key secret regardless of header or URL
transport. Reuse a trusted backend/proxy if the project already has one. If adding a
server boundary would exceed the request, keep that browser route on the legacy provider
and record the migration as partial or blocked.

## Live catalogue qualification

Fetch `https://api.solidrpc.io/networks` with an ordinary unauthenticated HTTPS GET at
migration time. Require a successful response containing a JSON array. Locate each needed
network by numeric `chainId`, and validate these fields rather than relying on array order:

- `status` is `live`;
- `nodeTypes` is an array and includes `archive` when the application needs historical
  state or logs beyond full-node retention;
- `methods` is an array containing every required advertised method family.

Record the endpoint, UTC fetch time, chain ID, status, and relevant family/type values in
`SOLIDRPC_MIGRATION.md`; do not copy the whole catalogue into code or documentation. A
small mocked response shape in tests is acceptable if it is not used as a production
support list.

Treat `trace_*` as the `trace` family and read-only `debug_*` calls as the `debug` family.
Treat ordinary portable EVM JSON-RPC reads and writes as requiring `standard`. Other
namespaces or vendor extensions are unverified until supported by current official
documentation and an authenticated representative probe. A family advertisement is not
proof that every method or parameter combination works; probe every business-critical
trace, debug, proprietary, or deep-history shape before replacement.

Method-family coverage does not prove credential authorization. Qualify the intended production
credential and account policy for every route being activated. A successful read probe is not
write-scope evidence; retain a named transaction route and report partial replacement until an
authenticated write-safe validation strategy and exactly-once tests establish that boundary.

Do not infer archive requirements only from method names. Inventory explicit block tags,
block hashes, log ranges, and the oldest required application data. Catalogue `archive`
coverage is necessary for deep history; an authenticated read at a representative oldest
block is the replacement gate.

If the catalogue is unavailable, invalid, omits a chain, reports a non-live network, or
lacks required coverage, replacement is blocked. Add-mode scaffolding may still be built,
but its comparison path must report the unverified condition and production routing must
remain unchanged.

## Capacity qualification and limit responses

Replacement requires a capacity model for the intended production credential and runtime. Fetch
the effective, non-secret `X-RateLimit-Limit`, `X-RateLimit-Burst`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Quota-Limit`, `X-Quota-Remaining`, and
`X-Quota-Reset` values from authenticated responses. Use the same account, API key, and delegated
JWT constraints that production will use. When several constraints apply, use the lowest
effective account, key, or JWT limit. Missing or ambiguous effective limits leave capacity
unverified. Never substitute a public plan name, remembered default, or hardcoded allowance.

Measure and record:

- the largest batch as its count of valid JSON-RPC method calls;
- sustained and peak method calls per second after expanding batches;
- projected response units in the actual quota window, derived from authenticated account
  configuration and reset evidence rather than assuming a window; and
- all other traffic sharing the account, key, or delegated limit, plus retry amplification.

Each valid method call in an accepted JSON-RPC batch consumes capacity independently; a batch is
not one rate or quota unit merely because it is one HTTP request. Invalid array members are not
successful method calls, but must not be used to understate production demand. Require a stated,
deliberate headroom margin. Verify that no batch exceeds the effective burst, that measured burst
patterns and sustained demand fit rate and replenishment limits with that headroom, and that
aggregate projected usage fits both the quota window and the remaining capacity before reset. An
oversize batch cannot become admissible by waiting or retrying. Block replacement unless every
check passes or an account upgrade or overage path is explicitly approved and verified.

Do not prorate a monthly demand estimate from the current calendar month when the account may use a
different billing-cycle boundary. Use a conservative full-window estimate, or prorate only from
durable account-specific cycle-start/reset evidence.

Handle limit responses without unsafe retry or fallback:

- An authenticated rate-limit response is HTTP 429 with effective `X-RateLimit-*` headers.
  `Retry-After` is present only when waiting can make the request admissible; its absence can mean
  the request, such as an oversize batch, cannot fit. Do not retry blindly.
- Authenticated quota exhaustion is HTTP 402 when usage cannot continue. Use `X-Quota-Reset` to
  report the boundary, and require verified overage, an upgrade, or a later window before cutover;
  do not treat it as a transient provider failure or fall back to the legacy route.
- A keyless public SolidRPC limit response may be HTTP 429 with JSON-RPC error `-32005`. It does
  not qualify authenticated production capacity or credentials.

Qualification traffic itself consumes capacity. Count actual valid probe method calls, including
members of batches, and record their effect in the migration evidence. Accepted calls consume rate
tokens; tokens are not refunded when an upstream returns HTTP 5xx even though that upstream 5xx is
not charged to quota. HTTP-200 node responses, including JSON-RPC errors, can consume response
units. Keep probes representative and minimal.

## Request classification

Build a narrow allowlist from the application's observed read calls. Do not classify a
whole namespace as safe merely because common members are reads.

Never send these through a comparison path:

- transaction submission such as `eth_sendRawTransaction` or `eth_sendTransaction`;
- signing, wallet, account-unlock, or personal-account requests;
- node/consensus/admin mutations;
- any unknown method whose effects have not been established as read-only.

Batch handling must classify every member. If any member is a write, signing request, or
unknown, do not send that batch to the comparison provider. In full replace mode, send each write
exactly once to the one SolidRPC route only after credential scope and account policy for that
method are proven. Until then, retain the named write route on the legacy provider as an explicit
partial-migration boundary. Return that single response; never hedge or retry a write on another
provider after an ambiguous timeout.

## Stable read comparison

Do not byte-compare responses made independently at `latest`, `pending`, `safe`, or another
moving tag. Prefer an application-known finalized block hash/number. Otherwise resolve a
stable reference, verify both providers identify the same canonical block hash, then issue
equivalent reads against that exact block reference where the method permits it.

Compare JSON-RPC meaning, not request IDs or irrelevant presentation differences. Report
errors, block/hash disagreement, unsupported stable parameters, or ambiguous normalization
as inconclusive rather than a false mismatch or match. Comparison never changes the value
returned by the existing production path.
