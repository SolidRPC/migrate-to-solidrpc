---
name: migrate-to-solidrpc
description: Migrate an EVM application's compatible HTTPS JSON-RPC traffic from its current provider to one SolidRPC integration. Use when the user asks to migrate, switch, replace, or cut over an RPC provider to SolidRPC.
license: MIT
---

# Migrate to SolidRPC

Turn one migration request into a reviewed local change. For compatible HTTPS JSON-RPC,
the result is one SolidRPC integration: SolidRPC owns upstream diversity, routing,
failover, monitoring, and recovery.

Do not ask the user to choose between add and replace modes. An explicit request to
**migrate**, **switch**, **replace**, or **cut over** means replacement intent.

## Normal workflow

1. Inspect provider construction, chains, methods, writes, batches, historical depth,
   timeouts, transports, runtime boundaries, secrets, monitoring, infrastructure, and
   existing checks. Do not stop at an inventory when migration was requested.
2. Determine whether the application serves production traffic. Infer this from the
   repository and request when clear. If it remains unclear, ask only: “Does this
   application currently serve production traffic?”
3. Read [the integration contract](references/integration-contract.md), fetch the live
   network catalogue, and validate required coverage. Read
   [client adaptation](references/client-adaptation.md) before editing provider or
   authentication construction.
4. Qualify the applicable prototype or production path in
   [migration workflow and gates](references/migration-modes.md). Discover evidence
   before asking for it; if production inputs are still missing, ask one consolidated
   question containing every missing item.
5. Make the direct local code or configuration change, preserving the installed client
   library and the project's secret mechanism. Run relevant tests, type checks, lint, and
   build checks, plus focused deterministic routing tests.
6. Show the resulting Git diff and a Git-based rollback followed by the project's normal
   deployment process. Do not commit, push, deploy, or modify external or production state
   unless the user separately asks.

If a required production gate cannot be verified, a local cutover diff may still be
prepared for review when useful, but label it **not deployment-ready** and leave external
and production state unchanged. Never claim that a blocked migration is complete.

## Routing and request safety

- Make SolidRPC the sole active provider for qualified, compatible HTTPS JSON-RPC. Remove
  the legacy provider from that runtime route; do not create a provider selector, fallback
  pool, catch-all failover, or automatic rollback path. Git is the default rollback.
- Never shadow production traffic. Never fan out, hedge, compare, or retry a transaction,
  signing request, state-changing call, or unknown method across providers. Send an
  eligible write exactly once through its single qualified route.
- Keep WebSockets, subscriptions, webhooks, browser-held credentials, and proprietary APIs
  as explicit named boundaries when incompatible. They are separate remaining decisions,
  not a fallback for ordinary SolidRPC failures.
- Do not expose an API key to a browser. Never read, print, persist, or commit secret
  values. Ask only for the environment-variable or secret-reference **name**, and wire the
  project's existing secret mechanism.
- Do not create `SOLIDRPC_MIGRATION.md` or another persistent report unless the user asks
  for one; any requested report must be secret-free. Do not create signed evidence, HMAC
  artifacts, evidence-expiry checks, startup gates, or runtime route switches in the normal
  workflow.

Only if the user explicitly requests a runtime-selectable dual route, read
[advanced dual-route qualification](references/advanced-dual-route.md). That separate,
opt-in workflow must fail closed for the SolidRPC candidate without ever disabling the
existing rollback route or causing a total RPC outage.

## Verification and completion

Add target-project tests for observable runtime behavior: SolidRPC-only compatible
routing, exactly-once writes, no production shadowing or legacy HTTP fallback, explicit
incompatible boundaries, and secret-free output. Do not add application tests for the
agent's own questioning or classification unless the repository already tests migration
orchestration.

Verify the workflow itself through inspection, check results, and the Git diff: a prototype
must not be blocked by missing historical telemetry; production evidence must be discovered
before one consolidated question; a blocked cutover must leave production unchanged; and
the normal flow must create no migration or signed-evidence artifact.

When checks pass, finish the local migration and give a concise, secret-free summary of
what changed, what was tested, current incompatible boundaries, whether production capacity
was proven, and how to roll back with Git and the normal deployment process. When a required
check fails, leave external and production state unchanged and return one concise list of
what is still needed.
