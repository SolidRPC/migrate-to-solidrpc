# Migration modes and qualification gates

## Mode semantics

| Mode | Active portable HTTPS route | SolidRPC comparison | Legacy provider |
| --- | --- | --- | --- |
| Add (default) | Existing provider only | Manual, read-only, non-production command | Unchanged |
| Replace | SolidRPC only | Normal validation/tests; no production fanout | Inactive rollback configuration |
| Partial replace | SolidRPC for qualified portable HTTPS calls | Normal validation/tests | Active only for named incompatible features |
| Blocked replace | Existing provider only | Optional preparatory/manual validation | Remains active until gates pass |

Words such as “migrate,” “integrate,” “try,” or “add” do not authorize replacement. Use
replace mode only for an explicit request to replace, cut over, make primary, or make
SolidRPC the only provider.

Do not implement SolidRPC as one member of a customer-managed production fallback pool.
In add mode it is a manual evaluation path, not a fallback. In replace mode it owns the
qualified route without a legacy HTTPS fallback.

## Replacement gates

All applicable gates must pass before changing the active route:

1. **Inventory:** every construction site, chain, method, transport, environment boundary,
   write path, history need, and provider-specific dependency is classified.
2. **Catalogue:** the live catalogue was fetched during this run and verifies each required
   chain, node type, and advertised method family.
3. **Credential:** the intended runtime injects the configured key without exposing it, and
   an authenticated request succeeds. Durable evidence is bound to a non-reversible fingerprint
   of the intended key and delegated credential scope so rotation invalidates it. Key absence
   blocks cutover but not preparatory wiring.
4. **Capacity:** authenticated response headers establish the lowest effective account, key, and
   delegated-JWT rate, burst, and quota constraints. Measured aggregate production demand,
   batch-expanded sustained and peak method rate, largest valid-method batch, retry amplification,
   projected response units in the actual quota window, remaining capacity, and deliberate
   headroom all fit. Any required overage or upgrade is explicitly approved and verified.
5. **Representative behavior:** business-critical standard, trace/debug, batch, and oldest
   historical reads pass against SolidRPC at stable references.
6. **Writes:** the intended production credential and account policy are verified for every write
   method being cut over, and tests prove each transaction is submitted exactly once with no
   cross-provider retry, fanout, or comparison. A read-only probe cannot satisfy this gate.
7. **Boundaries:** WebSockets, subscriptions, webhooks, browser-held credentials, and
   proprietary APIs are either deliberately retained on the legacy provider or resolved.
8. **Project checks:** relevant unit/integration tests, type checks, lint/build checks, and
   secret/tracked-file review pass.

When a gate fails, leave the existing active route untouched. Record the failed evidence,
safe work completed, and the exact remaining action. Do not add a runtime flag that can
accidentally activate an unqualified route merely by setting an environment variable.

## Durable qualification evidence

Prefer a direct source or deployment-config cutover performed after the gates pass. When a
sample, template, or operational workflow must retain runtime-selectable legacy and SolidRPC
routes, SolidRPC activation must require a generated qualification artifact in addition to the
credential. Never treat a provider-name environment variable, boolean, or credential presence as
qualification.

Generate the artifact only from an explicit qualification command after catalogue validation and
authenticated representative reads succeed. Keep it non-secret and environment-specific. Record
at least:

- a schema version, requested mode, chain ID, and clean SolidRPC endpoint;
- a non-secret binding to the intended API key and delegated JWT credential set, never the
  credential values;
- authenticated integrity over the complete canonical payload, such as HMAC-SHA256 keyed by the
  intended API key; a plain fingerprint alone is insufficient;
- catalogue endpoint, fetch time, status, required method families, and required node types;
- the stable block number/hash and the representative read shapes that passed;
- authenticated `X-RateLimit-*` and `X-Quota-*` limit, remaining, and reset snapshots with
  observation times, but no credential or complete raw headers;
- the largest valid-method batch, batch-expanded sustained and peak method calls per second,
  projected response units per actual quota window, shared account/key/JWT traffic, retry
  amplification, selected headroom, and the resulting capacity decision;
- any required overage or upgrade approval and how its availability was verified;
- the actual number of valid qualification probe method calls and their capacity effect;
- qualification and expiry times, capped before any delegated JWT `exp` with a documented
  clock-skew margin; and
- booleans or identifiers for the deterministic project checks that were required.

Do not include an API key, credential-bearing URL, raw environment output, or signed transaction.
Ignore local evidence files by default or store them in the deployment control plane. At startup,
validate artifact integrity with the current credential, then its schema, chain, endpoint, mode,
credential binding, and expiry before constructing a SolidRPC
production client. Missing, malformed, expired, or mismatched evidence must fail before any
SolidRPC or legacy request. Creating evidence must never itself change production routing.

Tests for a selectable sample must cover missing, malformed, edited, expired, wrong-chain,
wrong-endpoint, credential rotation, delegated-JWT expiry, and valid evidence. The valid case must
prove the legacy HTTPS route receives zero requests for every route represented as replaced by the
artifact. Any retained route must be named in the artifact and test assertions.

## Add-mode comparison behavior

The comparison entrypoint must be explicit, such as a developer CLI command or isolated
diagnostic test. It must not be imported by the production provider module, invoked on a
timer, called from a user request, or registered as fallback transport.

Tests should make provider routing observable with deterministic request counters:

- an ordinary application read reaches only the existing provider;
- manual comparison reaches each provider only for allowlisted reads;
- a mismatch is reported but the existing provider remains authoritative;
- transaction submission reaches the existing provider once and SolidRPC zero times;
- absent credentials or catalogue failures make comparison fail clearly without affecting
  normal application behavior.

## Replace-mode behavior

For qualified portable HTTPS JSON-RPC, tests should prove the existing provider receives
zero requests and SolidRPC receives the expected request exactly once. This includes writes only
after their credential scope and account policy are separately qualified. Retain rollback
configuration without registering it as an automatic fallback.

If legacy-only behavior remains, isolate it by explicit capability or call site. Do not
route ordinary SolidRPC failures to the legacy provider. Name each retained feature in the
migration record so “partial” cannot be mistaken for full replacement.

## Required `SOLIDRPC_MIGRATION.md`

Create or update one file at the project root with these sections:

1. **Summary:** UTC date, requested mode, effective mode, and one-sentence result.
2. **Inventory:** component/call site, client library, runtime boundary, chain ID,
   transport, methods, writes, history requirement, current provider, and tests.
3. **Coverage evidence:** catalogue endpoint and fetch time, required versus advertised
   chain/family/node coverage, authenticated probes, and gaps. Record credential state only
   as configured/missing/untested. If durable qualification evidence controls activation,
   record its non-secret schema/version, expiry, and storage location.
4. **Capacity evidence:** observed effective non-secret limit, remaining, and reset headers;
   measured aggregate production demand and batch expansion; actual quota window and projected
   units; retry amplification; headroom; probe method-call count; required overage or upgrade
   approval; and pass/block outcome. Do not use public plan defaults as evidence.
5. **Routing after this change:** a table mapping portable reads, writes, manual comparison,
   WebSockets/subscriptions, and proprietary features to their active provider. State
   explicitly whether SolidRPC receives production traffic.
6. **Changes and validation:** files/behavior changed and exact checks with outcomes. Clearly
   distinguish deterministic mocks, authenticated checks, and optional public smoke tests.
7. **Rollback:** the concrete configuration/code reversal needed to restore the previous
   active route, without a secret value or credential-bearing URL.
8. **Gaps and remaining actions:** incompatible features, blocked gates, owners if known,
   and required cutover steps.

Merge with an existing migration record rather than discarding useful prior evidence.
Never place credentials, raw secret-manager output, or full URL-auth endpoints in the file.
