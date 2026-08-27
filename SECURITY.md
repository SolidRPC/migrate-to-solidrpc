# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Older or unreleased snapshots | No |

## Report a vulnerability privately

Use [GitHub Security Advisories](https://github.com/SolidRPC/migrate-to-solidrpc/security/advisories/new)
to report a vulnerability. Include the affected version, impact, non-secret reproduction details,
and any suggested mitigation. SolidRPC will coordinate disclosure and remediation through the
private advisory.

Do not put API keys, private RPC URLs, credentials, signed transactions, customer data, or an
unpublished exploit in a public issue, pull request, discussion, test fixture, or migration report.
If a credential has been exposed, revoke or rotate it immediately before reporting the incident.

Public issues may be used for non-sensitive bugs after confirming that the report and its logs are
free of secrets.

## Security expectations

The skill makes a local repository change and does not deploy it. Review the resulting code or
configuration diff and successful project checks before using the project's normal deployment
process. The default recovery path is a Git rollback followed by that same deployment process.

Never give the agent a secret value. Provide only the environment-variable name or secret-manager
reference, and keep credentials in the target project's existing secret mechanism. Safe
qualification uses authenticated, read-only requests; it must not shadow production traffic or
duplicate transactions or other state-changing calls.

Compatible HTTPS JSON-RPC traffic should have one active SolidRPC integration after migration, not
a customer-managed provider fallback pool. WebSockets, subscriptions, webhooks, browser-held
credentials, and provider-specific APIs remain explicit boundaries when they are incompatible.
The default workflow does not require a persistent migration report, signed qualification
evidence, an evidence-expiry check, or a runtime startup gate.

A runtime-selectable dual route is an advanced, explicit opt-in. Evidence validation may prevent
the SolidRPC candidate route from being enabled, but missing, expired, edited, or invalid evidence
must leave the existing rollback route available and must never cause a total RPC outage.
