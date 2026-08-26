# Client adaptation

Preserve the project's installed RPC client, version, chain definitions, error contract,
and public API unless a change is strictly required for SolidRPC. Do not introduce a new
client library solely to make the migration easier.

## Find the real routing surface

Search provider constructors, transport factories, dependency injection, environment
schema, workers, scripts, tests, wallet clients, and server/browser entrypoints. Trace
wrappers far enough to identify retries and fallbacks; changing a single URL can miss
secondary clients or accidentally retain a legacy pool.

Separate public/read clients from wallet/write clients. In add mode, neither production
client changes route. In replace mode, both portable reads and transaction submission use
the one qualified SolidRPC transport, while a transaction is still sent exactly once.

## Authentication choices

On a trusted server runtime, first use the current library's supported custom-header
mechanism with the clean endpoint and `X-API-Key`. Read the installed version's types or
official documentation before choosing exact options; do not guess an API from another
version.

Use a credential-bearing URL only if the client genuinely accepts a URL string and cannot
set headers, and only in a trusted runtime. Construct it in memory from the environment;
do not store or log it. If the client is browser-side, do not solve header limitations by
shipping the key in source, build-time environment, local storage, or a URL. Retain that
route or use an existing trusted server proxy and report the boundary.

Follow the project's environment convention. Add `SOLIDRPC_API_KEY` only when no comparable
name exists. Validate missing configuration with a clear error that names the variable but
never includes its value. Keep tracked examples blank and ensure real environment files are
ignored.

## Mode-specific construction

For add mode, put the SolidRPC client behind the explicit comparison entrypoint. The normal
application client must not import, instantiate, race, or fall back to it. Avoid library
features named `fallback`, `race`, `quorum`, `multi`, or similar on the production path.

For replace mode, construct one SolidRPC transport for each required chain. Keep legacy
configuration available for deliberate rollback, but do not instantiate it on qualified
portable paths. If incompatible capabilities remain, select them by an explicit feature or
method boundary, never by catch-all error fallback.

Do not expose a bare provider selector in a sample or reusable runtime. Either make the qualified
cutover an explicit source/deployment change, or require the durable evidence defined in
[migration modes and qualification gates](migration-modes.md) before constructing the SolidRPC
production client. Evidence generation is a separate diagnostic action and must not activate the
route automatically.

Preserve current retry policy only when it retries the same SolidRPC endpoint and is safe
for that method. Never automatically retry a write after an ambiguous response, and never
retry it through the legacy provider.

## Comparison implementation

Prefer a developer CLI or isolated diagnostic module that:

1. validates catalogue coverage and credential presence without displaying the key;
2. accepts or resolves an exact stable block reference;
3. runs only the project's explicit read allowlist against both clients;
4. emits a concise match/mismatch/inconclusive summary with sanitized errors;
5. exits nonzero for unverified coverage or mismatches without changing production state.

Do not accept arbitrary JSON-RPC method input unless the implementation independently and
reliably rejects writes, signing, unknown methods, and mixed unsafe batches.

## Verification

Use the project's existing test stack. Mock JSON-RPC servers on ephemeral ports and assert
request method, headers where safely represented by fixtures, payload, and per-provider
counts. Include success, mismatch, catalogue failure, missing configuration, unsupported
coverage, and write-path cases appropriate to the chosen mode.

Run the relevant type checker, tests, lint/build checks that do not rewrite files, diff
whitespace checks, and a tracked-files scan for secret-bearing environment files and
credential-looking URLs. Do not print suspected secret matches; report file names and
remediate them safely. Live public or keyless calls are optional and non-gating; only an
authenticated representative probe in the intended runtime can satisfy the credential and
behavior gates for replacement.
