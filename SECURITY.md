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

The skill is designed to avoid printing or committing credentials, duplicate transaction
submission, automatic cross-provider fallback, and unqualified provider cutover. A target
application can still have project-specific signing, retry, browser, WebSocket, or proprietary API
behavior. Review the generated `SOLIDRPC_MIGRATION.md` and application diff before deployment, and
run representative tests using the target project's normal secret-management process.
