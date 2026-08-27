# Migrate to SolidRPC

`migrate-to-solidrpc` turns one migration request into a direct, reviewed repository change.
It inspects an EVM application's RPC usage, qualifies the routes that can move, replaces
compatible HTTPS JSON-RPC traffic with one SolidRPC integration, runs the project's checks, and
shows the Git diff and rollback steps. It does not deploy the change.

After a completed migration, SolidRPC is the only active provider for compatible traffic.
SolidRPC owns upstream diversity, routing, failover, monitoring, and recovery; the application
does not maintain its own HTTP provider fallback pool.

The repository packages the same skill for Codex and Claude Code. The instructions live in
[`skills/migrate-to-solidrpc`](skills/migrate-to-solidrpc).

## One guided migration

Give the installed skill a normal migration request. It will:

1. Find provider construction, networks, methods, writes, historical requirements, retries,
   transports, runtime boundaries, secret references, monitoring, and project checks.
2. Infer whether the application is a prototype or serves production traffic. If the repository
   does not make that clear, it asks one concise classification question.
3. Qualify live network and method coverage, authenticated access, safe read-only behavior, and
   the applicable capacity path.
4. Edit the real client or deployment configuration directly. It does not add an Add/Replace
   chooser, provider selector, automatic fallback, or production shadow route.
5. Run the project's tests, type checks, lint, and build checks plus focused routing tests.
6. Return a concise, secret-free summary, the Git diff, and Git rollback instructions.

The skill never commits, pushes, or deploys the target application unless the user separately
requests that action. The normal rollback is a Git reversal followed by the application's usual
deployment process.

## Qualification behavior

### Prototype fast path

A prototype or application with no production traffic does not need historical telemetry,
measured peaks, or a production traffic profile. Migration can complete when:

- the intended trusted runtime has authenticated SolidRPC access;
- the live catalogue supports the required networks, method families, and historical depth;
- minimal read-only smoke tests pass;
- the project's tests and build pass; and
- no explicit repository setting exceeds the current account's available limits.

The result shows the applicable non-secret limits and states that production capacity has not yet
been proven. That is advisory unless an explicit batch, concurrency, polling, or request-budget
setting clearly exceeds a limit.

### Production applications

For production applications, the skill first searches existing monitoring, configuration, logs,
infrastructure, provider metrics, load tests, and billing data. It may need peak and sustained
batch-expanded request rate, quota-window usage, shared-account traffic, retry amplification,
largest batch, required networks and methods, historical depth, and timeout behavior.

If required facts remain missing, the skill asks one consolidated question containing every
missing item. It may prepare a useful local diff for review, but marks production cutover as
blocked and leaves external and production state unchanged until all applicable gates pass.

## Routing and safety

- Compatible HTTPS reads and qualified writes use one SolidRPC route.
- Transactions and other state-changing calls are sent exactly once. They are never compared,
  mirrored, hedged, or retried through another provider after an ambiguous response.
- Production traffic is not shadowed by default.
- WebSockets, subscriptions, webhooks, browser-held credentials, and provider-specific APIs stay
  behind explicit named boundaries when they are incompatible. They are remaining migration
  decisions, not fallback for a failed SolidRPC request.
- The default workflow creates no runtime qualification artifact, HMAC/startup gate, provider
  switch, or persistent migration report.

Never paste an API key into an agent prompt. Give the skill only the environment-variable or
secret-manager reference name. Trusted server clients should prefer `X-API-Key` with
`https://rpc.solidrpc.io/evm/{chainId}`. The skill preserves the project's existing secret
mechanism and never reads, prints, persists, or commits the secret value.

## Install with Codex

Install the exact release from the GitHub marketplace:

```bash
codex plugin marketplace add SolidRPC/migrate-to-solidrpc --ref v0.1.3
codex plugin add migrate-to-solidrpc@solidrpc
```

Start a new Codex task and ask:

```text
Use $migrate-to-solidrpc to migrate this application's compatible RPC traffic to SolidRPC.
```

Implicit discovery remains enabled, so a clear request such as “migrate this app from its current
RPC provider to SolidRPC” can also load the skill. See the
[OpenAI plugin documentation](https://developers.openai.com/codex/build-plugins) for the plugin
package model.

## Install with Claude Code

Claude Code accepts a pinned GitHub marketplace reference:

```bash
claude plugin marketplace add SolidRPC/migrate-to-solidrpc@v0.1.3
claude plugin install migrate-to-solidrpc@solidrpc
```

Restart Claude Code, then invoke the namespaced skill:

```text
/migrate-to-solidrpc:migrate-to-solidrpc
Migrate this application's compatible RPC traffic to SolidRPC.
```

The tag is part of the marketplace source command, so this installs the pinned release rather
than an unpinned latest checkout. See the
[Claude Code marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## Compatibility

| Host | Package | Invocation | Release verification |
| --- | --- | --- | --- |
| Codex CLI and desktop | `.codex-plugin/plugin.json` | `$migrate-to-solidrpc` or implicit discovery | Local package installation, discovery, structural validation, and model-driven evaluation are recorded in the release evaluation; the published tag is verified at release time. |
| Claude Code | `.claude-plugin/plugin.json` | `/migrate-to-solidrpc:migrate-to-solidrpc` | Local marketplace installation, strict validation, and skill discovery are recorded in the release evaluation; the published tag is verified at release time. |
| Other Agent Skills hosts | `skills/migrate-to-solidrpc/SKILL.md` | Host-specific | The core instructions are portable, but unlisted hosts are not release-qualified. |

The GitHub repository is not automatically listed in OpenAI's universal plugin directory.
Directory submission and workspace rollout are separate distribution steps.

## viem example

[`examples/viem-app`](examples/viem-app) is the canonical post-migration state:

- one fixed SolidRPC HTTPS transport for compatible reads and writes;
- no legacy HTTP provider, runtime selector, or automatic fallback in the default app;
- a manual `npm run rpc:smoke` command for authenticated read-only catalogue, chain, and current
  limit checks;
- explicit WebSocket and provider-specific boundaries; and
- deterministic routing, safety, prototype, production-policy, secret-output, and advanced-route
  tests on ephemeral local servers.

The advanced selectable-route example is isolated from the default app. It exists only to prove
that expired or invalid evidence can disable the SolidRPC candidate without disabling the legacy
rollback route or causing a total outage.

Run the example and untouched pre-migration fixture checks with Node.js 22 or newer:

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

Release validation also runs the bundled skill and plugin validators, Claude Code strict
validation, metadata and secret scans, and `git diff --check`. Actual host and forward-evaluation
results are recorded in [`tests/FORWARD_EVALUATION.md`](tests/FORWARD_EVALUATION.md).

## Advanced dual route

A runtime-selectable dual route is not part of the normal migration. If explicitly requested,
the skill can use signed, environment-specific qualification evidence to enable a SolidRPC
candidate. Missing, edited, expired, or invalid evidence disables only that candidate; the
existing rollback route remains operational. Individual SolidRPC failures still do not trigger
per-request fallback.

## Security and limitations

Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability. Do not include credentials,
private endpoints, signed transactions, or customer data in issues, diffs, test fixtures, or
reports.

Deterministic mocks prove routing and decision invariants, not live service availability or
production capacity. Every application still requires current catalogue coverage, authenticated
access, representative method checks, and the qualification path appropriate to its traffic.
Live host behavior not exercised end to end is called out explicitly in the release evaluation.

## License

[MIT](LICENSE)
