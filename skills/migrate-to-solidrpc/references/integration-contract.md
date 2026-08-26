# SolidRPC integration contract

Use this contract for migration decisions. Re-fetch service-owned discovery data during
each migration rather than copying current catalogue entries into the target project.

## Endpoint and authentication

- JSON-RPC transport is HTTPS POST.
- The clean endpoint is `https://rpc.solidrpc.io/evm/{decimalChainId}`.
- On a trusted server-side client, send the API key in `X-API-Key`. This keeps the key out
  of URLs and leaves `Authorization` available for customer-signed JWTs.
- If a trusted-runtime client only accepts an RPC URL, it may use
  `https://rpc.solidrpc.io/{apiKey}/evm/{decimalChainId}`. Never render that URL in logs,
  errors, reports, shell history, or committed configuration.
- Do not configure more than one API-key transport on the same request.
- SolidRPC does not expose WebSocket JSON-RPC and does not support `eth_subscribe`.

Keep credentials in the project's established secret mechanism. If none exists, add a
blank `SOLIDRPC_API_KEY` entry to the tracked environment example and ignore real local
environment files. Never ask for, inspect, echo, interpolate into a diagnostic command,
commit, or report the value. Check only whether the intended runtime injects it.

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

Do not infer archive requirements only from method names. Inventory explicit block tags,
block hashes, log ranges, and the oldest required application data. Catalogue `archive`
coverage is necessary for deep history; an authenticated read at a representative oldest
block is the replacement gate.

If the catalogue is unavailable, invalid, omits a chain, reports a non-live network, or
lacks required coverage, replacement is blocked. Add-mode scaffolding may still be built,
but its comparison path must report the unverified condition and production routing must
remain unchanged.

## Request classification

Build a narrow allowlist from the application's observed read calls. Do not classify a
whole namespace as safe merely because common members are reads.

Never send these through a comparison path:

- transaction submission such as `eth_sendRawTransaction` or `eth_sendTransaction`;
- signing, wallet, account-unlock, or personal-account requests;
- node/consensus/admin mutations;
- any unknown method whose effects have not been established as read-only.

Batch handling must classify every member. If any member is a write, signing request, or
unknown, do not send that batch to the comparison provider. In replace mode, send each
write exactly once to the single active route and return that response; never hedge or
retry it on another provider after an ambiguous timeout.

## Stable read comparison

Do not byte-compare responses made independently at `latest`, `pending`, `safe`, or another
moving tag. Prefer an application-known finalized block hash/number. Otherwise resolve a
stable reference, verify both providers identify the same canonical block hash, then issue
equivalent reads against that exact block reference where the method permits it.

Compare JSON-RPC meaning, not request IDs or irrelevant presentation differences. Report
errors, block/hash disagreement, unsupported stable parameters, or ambiguous normalization
as inconclusive rather than a false mismatch or match. Comparison never changes the value
returned by the existing production path.
