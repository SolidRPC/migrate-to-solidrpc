# Advanced runtime-selectable dual route

Read this reference only when the user explicitly requests a runtime-selectable dual route.
It is not part of a normal migration, prototype fast path, or direct production cutover.

## Safety model

Keep two operator-selected states, never a per-request fallback pool:

- **rollback route:** the existing provider remains independently constructible and usable;
- **SolidRPC candidate:** available only after environment-specific qualification evidence
  validates at runtime.

Missing, malformed, edited, expired, wrong-environment, wrong-chain, or credential-mismatched
evidence must disable only the SolidRPC candidate. It must leave the rollback route usable,
select it safely when the candidate was requested but cannot start, and surface a clear
candidate-blocked status. Evidence failure must never disable both routes or cause a total
RPC outage.

Once an operator has selected a valid SolidRPC candidate, do not route individual errors to
the rollback provider. An operator may deliberately select the rollback state using the
documented runtime mechanism. Transactions and other state-changing calls still go to one
selected route exactly once.

## Qualification evidence

Generate evidence only through an explicit qualification command. Keep it secret-free,
environment-specific, ignored locally or stored in the deployment control plane, and
separate from ordinary application configuration. It should bind at least:

- schema version, environment, chain, clean endpoint, and candidate route;
- live-catalogue fetch time and required network, node-type, and method-family coverage;
- representative authenticated read shapes and stable block references;
- applicable account limits and production demand/capacity decision;
- required deterministic project checks; and
- qualification and expiry times, bounded before any delegated credential expiry.

Protect the complete canonical payload against editing, for example with HMAC-SHA256 keyed
by the intended API key. Store only a non-secret binding, never the key, delegated token,
credential-bearing URL, signed transaction, or raw secret-manager output. Credential
rotation invalidates candidate evidence but must not affect the rollback route.

At startup, validate integrity before trusting any field, then schema, environment, chain,
endpoint, credential binding, delegated scope/expiry, evidence expiry, catalogue coverage,
and required check identifiers. Do not construct or send a request through the SolidRPC
candidate until all validations pass.

## Required advanced tests

In addition to normal exact-once and boundary tests, cover missing, malformed, edited,
expired, wrong-environment, wrong-chain, wrong-endpoint, rotated-credential, and valid
evidence. Every invalid case must prove:

- zero requests reach the SolidRPC candidate;
- the rollback route remains available and handles its single expected request; and
- startup or route selection cannot produce a total RPC outage.

The valid case must prove compatible traffic reaches only SolidRPC while selected. Switching
routes must be an explicit operator action, never an automatic response to an RPC failure.
