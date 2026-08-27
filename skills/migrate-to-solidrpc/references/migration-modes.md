# Migration workflow and qualification gates

The normal migration has one outcome: SolidRPC is the only active provider for compatible
HTTPS JSON-RPC after qualification. There is no add/replace choice and no customer-managed
fallback pool.

## Classify the application

Infer production status before asking. Production signals include deployed environments,
real domains, production manifests, alerting, SLOs, usage dashboards, billing controls,
customer traffic, and an explicit live-service statement. Prototype signals include an
example, tutorial, local-only app, test fixture, hackathon project, or explicit statement
that it has no production traffic.

If the evidence conflicts or remains unclear, ask one concise question: “Does this
application currently serve production traffic?” Do not combine that classification
question with a mode choice.

## Prototype fast path

A prototype does not need measured peaks, historical usage, or production telemetry. All
of these applicable gates must pass:

1. The intended trusted runtime has authenticated SolidRPC access through a named secret
   reference without exposing the value.
2. The live catalogue supports every required network, method family, and node type.
3. Minimal read-only smoke tests at stable references pass for representative methods and
   history shapes.
4. Relevant project tests, type checks, lint, and build checks pass.
5. No explicit repository configuration—such as batch size, concurrency, polling rate, or
   request budget—exceeds the current account's available plan limits.

Show the applicable non-secret plan limits and their source. State that production capacity
has not yet been proven. That statement is advisory and does not block prototype migration
unless explicit repository configuration clearly exceeds an available limit. Unknown future
traffic is not evidence that the prototype exceeds a limit.

When the gates pass, directly replace the compatible HTTP route locally and test that the
legacy provider receives zero compatible requests.

## Production qualification

Before asking the user, search existing monitoring queries and dashboards, configuration,
logs, infrastructure manifests, load tests, provider metrics, billing data, and deployment
settings. Derive what can be supported and cite the local source or non-secret observation.

Qualify the facts applicable to the observed application:

- peak and sustained method calls per second after expanding batches;
- quota-window usage, aggregate shared-account traffic, and retry amplification;
- largest valid-method batch and request concurrency;
- required networks, method families, and oldest historical depth;
- timeout, retry, and ambiguous-write behavior;
- effective rate, burst, batch, quota, and quota-window limits for the intended account;
- representative read behavior and, where applicable, write authorization and exactly-once
  behavior; and
- deliberate capacity headroom.

If facts remain missing after discovery, ask **one** question containing the complete list,
for example: “To qualify the production cutover, I still need [all missing facts]. Where can
I find those measurements or configurations?” Ask for a credential reference name when
needed, never a credential value. Do not interrupt later with separate follow-up questions;
collect any newly discovered missing facts into the same unresolved list.

Production cutover is qualified only when current catalogue, authenticated behavior,
project checks, request safety, and applicable demand-versus-capacity gates pass. Do not
invent a requirement that the repository does not use, but do not waive an observed one.

## Direct migration change

For qualified compatible traffic:

- replace the current HTTPS transport with one SolidRPC transport;
- remove legacy HTTP construction from the active route rather than preserving a switch;
- remove customer-side fallback, quorum, race, or automatic failover behavior;
- keep retries only when the same-endpoint behavior is safe for the classified method;
- use explicit call sites for incompatible WebSockets, subscriptions, webhooks,
  browser-held credentials, and proprietary APIs; and
- make every eligible state-changing call exactly once.

Do not create a persistent migration report unless the user explicitly requests one, and
keep any requested report secret-free. Do not create a qualification artifact, HMAC,
startup gate, or runtime selector. The review evidence is the local diff, check results,
and concise final summary. The rollback is Git reversal of the migration diff followed by
the project's normal deployment process.

## Blocked production cutover

If a required production gate cannot be verified, keep external and production state
unchanged. When useful, prepare the direct local cutover diff so the user can review it, but
mark it **not deployment-ready** and do not commit, push, or deploy it. Do not add a runtime
selector as a substitute for qualification and do not claim completion.

Return one concise, secret-free list containing:

- the failed or missing gates;
- any local review-only change and checks that were completed;
- each incompatible boundary that remains; and
- the exact evidence or decision still needed before the user's normal deployment.

## Deterministic assertions

Adapt the project's tests so routing is observable with local mock servers on ephemeral
ports where practical. Cover compatible reads and writes reaching SolidRPC only, writes
counted exactly once, zero compatible requests to the legacy HTTP route, and explicit
WebSocket or proprietary boundaries that cannot catch ordinary SolidRPC errors. Check
commands and application errors for secret-free output.

Verify agent-workflow behavior through repository inspection, the resulting diff, and the
final response rather than adding meta-tests to an ordinary application: a telemetry-free
prototype is not blocked, production telemetry is discovered before one consolidated
question, blocked production stays unchanged, and no normal-flow HMAC, evidence file,
runtime migration file, or `SOLIDRPC_MIGRATION.md` is created.

Mocks prove routing invariants, not live service capacity. Label live authenticated smoke
tests separately from deterministic project checks.
