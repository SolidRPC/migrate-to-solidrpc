# Client adaptation

Preserve the project's installed RPC client, version, chain definitions, error contract,
and public API unless SolidRPC requires a narrow change. Verify options against the
installed version or its official documentation; do not introduce another client library
for convenience.

## Find the complete route

Search provider constructors, transport factories, environment schemas, dependency
injection, workers, scripts, wallet clients, browser and server entrypoints, tests,
deployment configuration, and infrastructure. Trace wrappers far enough to find retry,
fallback, quorum, race, load-balancing, and health-check behavior. Changing one URL is not
enough if a second client still serves compatible traffic.

Classify each observed boundary:

- portable HTTPS reads;
- transaction submission and other writes;
- batches and retries;
- WebSockets and subscriptions;
- webhooks or enhanced/provider-specific APIs; and
- browser-side clients that cannot hold a credential.

## Construct one SolidRPC route

For each qualified chain, construct one SolidRPC HTTPS transport. Prefer the client's
custom-header support with the clean endpoint and `X-API-Key`; use the constrained
alternatives in [the integration contract](integration-contract.md) only when required.
Consume the existing secret reference at runtime without inspecting or logging its value.
Tracked examples may contain the variable name with a blank placeholder value, never a real
credential.

Replace compatible client construction directly. Remove the legacy HTTP provider and
customer-side fallback from that active runtime path. Do not add a provider-name variable,
boolean cutover switch, credential-triggered selector, race, quorum, automatic failover, or
catch-all fallback. Git retains the old implementation for rollback.

If an incompatible feature must stay temporarily, isolate it through its existing explicit
feature or call site. Do not route ordinary SolidRPC errors to it and do not describe it as
provider fallback. Report the exact remaining decision needed to migrate or retire that
feature.

For a browser client, reuse an existing trusted proxy. Do not ship the key through source,
build-time environment, local storage, headers set in browser code, query parameters, or an
RPC URL. If no trusted boundary is in scope, leave that browser client unchanged and report
the migration as partial.

## Writes, retries, and timeouts

Separate public/read clients from wallet/write clients when the library already does so,
but route every qualified compatible client to SolidRPC only. A write moves only after its
credential/account policy and exactly-once behavior are verified.

Never retry a write after an ambiguous response, send it to two providers, compare it, or
fall back after an error. Preserve a same-SolidRPC-endpoint retry only when the method is
known read-only or the existing application has a method-safe idempotency guarantee. Reject
or isolate a mixed batch whose members cannot all be classified safely.

## Verification

Use the existing test stack and mock JSON-RPC servers on ephemeral ports where practical.
Assert method, endpoint identity, sanitized authentication presence, payload, returned
value, and request counts without using a real secret fixture. Important observations are:

- compatible application calls reach SolidRPC and the legacy HTTP server receives zero;
- each transaction or state-changing call is sent exactly once;
- no comparison, background shadow, or error-triggered cross-provider retry occurs;
- missing configuration names the required secret reference without displaying a value;
- WebSocket and proprietary paths remain explicit and cannot catch ordinary HTTP errors;
  and
- project checks and a secret-safe diff pass.

Run live smoke tests only through the intended trusted runtime. Keep them minimal and
read-only; deterministic mocks remain the source of request-count assertions.
