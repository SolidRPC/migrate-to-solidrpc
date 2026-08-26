# Migrate to SolidRPC

`migrate-to-solidrpc` is an agent skill for safely adding SolidRPC to an EVM
application or replacing its current RPC provider after qualification. It inventories the
application first, preserves the existing client library, verifies coverage against the live
SolidRPC catalog, qualifies the real workload against authenticated runtime limits, and leaves a
durable `SOLIDRPC_MIGRATION.md` in the migrated project.

The repository is packaged as a skills-only plugin for Codex, ChatGPT environments that support
OpenAI plugins, and Claude Code. The migration instructions themselves live in
[`skills/migrate-to-solidrpc`](skills/migrate-to-solidrpc).

| Host | Package entry point | Explicit invocation | Release evidence |
| --- | --- | --- | --- |
| Codex CLI and desktop | `.codex-plugin/plugin.json` | `$migrate-to-solidrpc` | Structural plugin validation and independent skill runs tested; tagged install is verified at release |
| Claude Code | `.claude-plugin/plugin.json` | `/migrate-to-solidrpc:migrate-to-solidrpc` | Strict manifest, marketplace install, and discovery tested; full model-driven evaluation remains noted below |
| ChatGPT environments with custom OpenAI-plugin support | `.codex-plugin/plugin.json` | Select the installed skill | Package-compatible; availability and policy vary by workspace and client |
| Other Agent Skills hosts | `skills/migrate-to-solidrpc/SKILL.md` | Host-specific | Core instructions are portable, but unlisted hosts are not release-qualified |

## Migration modes

| Mode | Activation | Routing outcome |
| --- | --- | --- |
| Add | Default | Existing production routing is unchanged. SolidRPC is available only through an explicit, manual, read-only comparison path. |
| Replace | Must be requested explicitly | After all qualification gates pass, SolidRPC becomes the sole active route for portable HTTPS JSON-RPC traffic. The old route stays inactive for rollback and may remain active only for an incompatible feature. |

Both modes fetch `https://api.solidrpc.io/networks` rather than relying on a hardcoded network
list. Comparisons use a stable block number or hash, and transactions, signing requests, unknown
methods, and state-changing calls are never shadowed. WebSockets, `eth_subscribe`, webhooks, and
provider-specific APIs are retained and reported as a partial migration when they are not
portable.

Replacement also requires capacity evidence for the target application's largest batch, expanded
method-call rate, quota-window demand, shared traffic, retry amplification, and deliberate
headroom. Effective limits come from authenticated `X-RateLimit-*` and `X-Quota-*` response
headers, not a hardcoded plan table. If that evidence is missing or insufficient, replacement
stays inactive.

## Requirements

- An EVM application whose repository the agent can inspect, edit, and test.
- Network access to `https://api.solidrpc.io/networks` during qualification.
- A SolidRPC API key exposed through the target project's secret mechanism for authenticated
  qualification and replacement. The skill defaults to `SOLIDRPC_API_KEY` only when the project
  has no established convention.
- A measured traffic profile covering the largest valid-method batch, sustained and peak RPC
  method calls per second, projected response units per quota window, shared-account traffic, and
  retry amplification.
- Representative tests or safe read-only probes for every route being cut over.

Do not paste an API key into an agent prompt. Put it in an ignored environment file, CI secret, or
secret manager. Trusted server-side clients should prefer `X-API-Key` with the clean endpoint
`https://rpc.solidrpc.io/evm/{chainId}`. Bearer API-key authentication is a fallback only when a
client can set `Authorization` but cannot set `X-API-Key`; do not use it when that header already
carries another credential or a customer JWT is required. URL authentication is reserved for
string-only clients. Configure exactly one API-key transport.

## Install with Codex

Install the tagged marketplace and plugin from GitHub:

```bash
codex plugin marketplace add SolidRPC/migrate-to-solidrpc --ref v0.1.1
codex plugin add migrate-to-solidrpc@solidrpc
```

Start a new Codex task after installation. Invoke the skill explicitly when you want deterministic
mode selection:

```text
Use $migrate-to-solidrpc to add SolidRPC to this application.
```

```text
Use $migrate-to-solidrpc in replace mode and make SolidRPC the only provider for compatible HTTPS JSON-RPC traffic.
```

The skill also has discovery metadata, so Codex can select it for a clearly matching migration
request.

## Install with Claude Code

Add the GitHub marketplace and install the plugin:

```bash
claude plugin marketplace add SolidRPC/migrate-to-solidrpc
claude plugin install migrate-to-solidrpc@solidrpc
```

Restart Claude Code after installation. Invoke the namespaced skill explicitly with:

```text
/migrate-to-solidrpc:migrate-to-solidrpc
```

Then state either that SolidRPC should be added for comparison or explicitly request replacement.
Claude Code reads the same `SKILL.md` and references as Codex; only the plugin manifest,
installation command, and explicit invocation syntax differ.

## ChatGPT and OpenAI distribution

The repository includes an OpenAI plugin manifest and a standard skill directory. It is suitable
for ChatGPT environments that support installing custom OpenAI plugins, but this release is tested
through Codex rather than every ChatGPT client or workspace configuration. The Codex CLI commands
above are not ChatGPT installation commands.

Publishing this GitHub repository does not list the plugin in OpenAI's universal plugin directory.
Directory submission, review, and any ChatGPT workspace rollout are separate release steps.

## Standalone and local testing

The plugin wrapper is optional. To make the skill project-local in Codex, copy
`skills/migrate-to-solidrpc` into the target repository's `.agents/skills/` directory. For a local
Claude Code checkout, run:

```bash
claude --plugin-dir /path/to/migrate-to-solidrpc
```

Use a checkout of the `v0.1.1` tag when you need a reproducible installation. Other Agent Skills
hosts may understand the core `SKILL.md`, but they are not claimed as supported until evaluated.

## Validation

CI performs structural validation of the skill and both plugin packages, checks release metadata,
and runs installation, type checking, and deterministic tests for the sample and baseline fixture.
The forward-evaluation evidence, including authenticated read-only probes and known limitations, is
recorded in [`tests/FORWARD_EVALUATION.md`](tests/FORWARD_EVALUATION.md).

Run the Node.js checks locally with Node.js 22:

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

The completed viem example is illustrative and deliberately demonstrates partial read replacement:
qualified reads use SolidRPC only, while signed transaction submission stays on the legacy route
until separate write-scope and account-policy evidence exists. Full replacement must be qualified
for the target application, chain, method families, historical depth, authentication scopes, and
runtime boundaries; evidence from one project must not be reused as a universal cutover token.

## Security and limitations

Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability. Never include credentials in
an issue, pull request, discussion, migration record, or test fixture.

Current release validation covers deterministic routing, capacity, error classification,
credential-transport, and qualification-evidence behavior. Evidence is HMAC-protected by the
current API key and, when a customer JWT is used, expires before its `exp` claim. The final v0.1.1
sample also completed an authenticated Ethereum catalog, capacity-header, stable-read,
durable-evidence, and SolidRPC-only read flow with a temporary credential. That narrow run qualifies the sample
configuration used for the test; it is not reusable evidence for another application or workload.
No test qualifies live transaction submission, every trace/debug method, all archive-depth
boundaries, browser-only clients, enhanced APIs, webhooks, or WebSocket subscriptions. Mocks prove
routing invariants rather than production reliability.

The SolidRPC website and migration CTAs are maintained outside this repository. Website changes
remain a separately reviewed and deployed release even when they point to this tagged plugin.

## License

[MIT](LICENSE)
