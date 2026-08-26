# viem migration example

This server-side TypeScript app demonstrates a fail-closed SolidRPC migration. The
normal `app` entrypoint is permanently wired to the existing provider. There is no
environment variable that can accidentally cut over production traffic.

## Configure

```sh
npm ci
cp .env.example .env
```

Set `LEGACY_RPC_URL`, `SOLIDRPC_API_KEY`, `CHAIN_ID`, and `ACCOUNT_ADDRESS`. Keep
real environment files ignored. The sample never prints an API key, customer JWT, or
legacy URL and never writes those values into qualification evidence. Command failures emit
only a bounded, sanitized first line rather than a client stack that may contain an endpoint or
signed payload.

`SOLIDRPC_API_KEY_TRANSPORT` defaults to `x-api-key`. This sends the key in
`X-API-Key` to the clean `https://rpc.solidrpc.io/evm/{chainId}` endpoint and is the
preferred server-side transport. Set it to `bearer` only for a trusted client that
cannot set `X-API-Key` and does not need `Authorization` for anything else. If the key
requires a customer JWT, keep `x-api-key`, set `SOLIDRPC_CUSTOMER_JWT_REQUIRED=true`,
and provide `SOLIDRPC_CUSTOMER_JWT`. The sample rejects Bearer API-key mode in that
case and rejects an API key duplicated in the URL or both authentication headers. On the official
host it accepts only the exact clean `/evm/{chainId}` endpoint; `/public`, `/demo`, query variants,
and encoded aliases cannot produce authenticated qualification evidence.
Customer authorization must be a JWT with a numeric `exp`; evidence expires at least 30 seconds
before that token and must be regenerated after either credential rotates.

## Default and comparison paths

```sh
npm run app
npm run rpc:compare
```

`npm run app` performs a normal balance read through the legacy provider only. It does
not fetch the SolidRPC catalog or contact SolidRPC.

`npm run rpc:compare` is a manual, read-only add-mode path. Before either provider is
contacted, it fetches the live catalog from `https://api.solidrpc.io/networks` and
requires the configured chain to be live with the `standard` method family. It then
resolves a shared confirmed block, verifies the canonical block hash, and compares
balances at that exact block. A mismatch or incomparable result exits with status 2
and never changes the returned production result.

Comparison needs an authenticated SolidRPC key but does not need a production traffic
profile. A successful comparable run makes three SolidRPC method calls. Those probes
consume response quota. Retries are disabled, and no write is submitted or shadowed.
Comparison proves read behavior for the selected method; it is not durable replacement
qualification.

## Measure replacement capacity

Before `rpc:qualify`, fill every `RPC_*` capacity variable in `.env.example` from
observed production traffic:

- Largest valid-method batch, plus sustained and peak method calls per second after
  expanding JSON-RPC batches.
- Response units for both a day and a month. The qualification probe selects the value
  matching the live `X-Quota-Window` response instead of assuming a plan.
- Traffic already shared at the account, API-key, or delegated-token scope.
- Measured retry amplification, including application and intermediary retries.
- An explicit headroom percentage. The sample accepts 1–90 percent and does not invent
  a default.

Do not copy marketing plan limits into these variables. They describe demand. The
sample obtains the effective supply from one authenticated `eth_chainId` response and
requires valid `X-RateLimit-Limit`, `X-RateLimit-Burst`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Quota-Limit`,
`X-Quota-Window`, `X-Quota-Used`, `X-Quota-Remaining`, and `X-Quota-Reset`
headers.

Qualification blocks when the largest batch exceeds burst, expanded sustained or instantaneous
peak traffic exceeds the live per-second rate with headroom, projected units exceed live quota with
headroom, current usage plus remaining-window demand would consume that headroom, the
remaining window cannot fit projected traffic and the remaining probes, or required
headers are missing or inconsistent. This sample does not accept an
unverifiable overage assertion. Capacity beyond the returned quota needs separately
approved and account-verified evidence before adapting this gate.

The sample conservatively reserves a full measured day/month demand through the reported reset;
it does not prorate from an assumed calendar-month or billing-cycle start. A production adaptation
may reduce that estimate only with durable evidence of the account's actual quota-cycle boundary.

## Qualify and exercise partial read replacement

```sh
npm run rpc:qualify
npm run app:solidrpc
```

`rpc:qualify` performs, in order:

1. Live catalog validation.
2. One authenticated `eth_chainId` capacity probe and live-header gate.
3. The three-call stable-block comparison.
4. Durable evidence creation only when capacity qualifies and results match.

The successful qualification therefore records four SolidRPC RPC requests, four method
calls, and four response units. The evidence expires at the earliest of the configured
qualification lifetime, live quota reset, and any customer JWT expiry minus a 30-second safety
margin. It records the traffic profile, safe
limit values, calculations, catalog snapshot, comparison block/hash, authentication
transport, and probe cost, but no credentials or provider URL secrets. An HMAC-SHA256 over the
canonical evidence payload, keyed by the current API key, makes edits or credential rotation fail
closed.

`app:solidrpc` fails closed when evidence is missing, malformed, expired, edited, or does not
match the current chain, endpoints, address, credentials, authentication shape, capacity profile,
or required routing check. With valid evidence, the qualified `eth_getBalance` read goes only to
SolidRPC and does not instantiate the legacy read client.

This sample is intentionally a **partial read replacement**, not proof of a full replace-mode
cutover. Its qualification probes do not establish transaction authorization, account policy, or
write-method scope. `eth_sendRawTransaction` therefore remains explicitly on the legacy route and
is sent exactly once. A real full replacement may move portable writes to SolidRPC only after
separate write-scope evidence and exactly-once tests pass. The legacy route is never an automatic
fallback for failed SolidRPC reads.

## Limit responses

The exported pure classifier demonstrates safe handling without enabling automatic
retries:

- Authenticated HTTP 429 with `Retry-After` permits a delayed retry of a read only.
- HTTP 429 without `Retry-After` where `requiredTokens` exceeds
  `X-RateLimit-Burst` requires reducing or splitting the read batch; waiting cannot make
  it fit.
- Authenticated HTTP 402 is quota exhaustion. Use `X-Quota-Reset`, or obtain an
  approved plan/capacity change, instead of retrying immediately.
- SolidRPC public-route HTTP 429 JSON-RPC `-32005` is explicitly non-production and
  cannot qualify replacement.

Never automatically retry transaction submission. The exported transaction methods
submit an already-signed raw transaction exactly once to their explicitly assigned route; in this
partial sample that route remains legacy. Comparison and qualification never submit, mirror,
retry, or shadow writes.

## Scope and verification

This sample does not migrate WebSockets, `eth_subscribe`, browser-held credentials,
webhooks, deep archive access, trace/debug calls, or provider-specific APIs. Those paths
need independent qualification or must stay on their existing provider and be reported
as a partial migration.

```sh
npm run typecheck
npm test
```

The 39 tests use ephemeral local catalog and JSON-RPC servers. They cover default isolation,
catalog failure and unsupported chains, stable comparison, authenticated capacity
headers and fail-closed gates, non-secret evidence, X-API-Key and conditional Bearer
authentication, HMAC tamper rejection, JWT-bounded expiry, sanitized errors, HTTP-200 JSON-RPC
errors, limit-response semantics, SolidRPC-only qualified reads with an unreachable legacy read
endpoint, and exactly-once transaction submission on the retained legacy route. Mocks demonstrate routing and
qualification invariants; they do not establish production capacity or service quality.
