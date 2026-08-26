# Migrate to SolidRPC

This private, review-stage repository contains a standalone Codex skill for safely migrating an EVM application to SolidRPC. The skill lives at [`skills/migrate-to-solidrpc`](skills/migrate-to-solidrpc) and is not yet packaged as a plugin or connected to the SolidRPC website.

## Migration modes

The default request keeps the application's current provider on its production path. It adds SolidRPC configuration and a separately invoked, read-only comparison path so responses can be evaluated without shadowing writes or changing user traffic.

```text
Use $migrate-to-solidrpc to add SolidRPC to this application.
```

Replacement is explicit. The skill first inventories and qualifies the application's chains and RPC methods, then moves compatible HTTPS JSON-RPC traffic to SolidRPC while retaining the old provider only as inactive rollback configuration or for an incompatible feature.

```text
Use $migrate-to-solidrpc in replace mode and make SolidRPC the primary RPC provider.
```

## Credentials

Use `SOLIDRPC_API_KEY` unless the target project already has an established environment-variable convention. Keep real values in ignored environment files or a secret manager. Never commit, log, or copy an API key into generated source, test fixtures, migration reports, or URLs when the client supports the `X-API-Key` header.

## Validation

The repository includes an untouched viem fixture for forward evaluations and a completed migrated viem example. The actual independent-agent runs, diffs, outcomes, and limitations are recorded in [`tests/FORWARD_EVALUATION.md`](tests/FORWARD_EVALUATION.md). CI validates the skill metadata and runs each application's checks. Run the same Node.js checks locally with:

```bash
cd tests/fixtures/viem-app-before
npm ci
npm run typecheck
npm test

cd ../../../examples/viem-app
npm ci
npm run typecheck
npm test
```

The website migration CTAs, public distribution, and plugin packaging remain deferred until the skill has been reviewed and approved.
