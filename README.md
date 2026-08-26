# Migrate to SolidRPC

`migrate-to-solidrpc` is an agent skill for safely adding SolidRPC to an EVM
application or replacing its current RPC provider after qualification. It inventories the
application first, preserves the existing client library, verifies coverage against the live
SolidRPC catalog, and leaves a durable `SOLIDRPC_MIGRATION.md` in the migrated project.

The repository is packaged as a skills-only plugin for Codex, ChatGPT environments that support
OpenAI plugins, and Claude Code. The migration instructions themselves live in
[`skills/migrate-to-solidrpc`](skills/migrate-to-solidrpc).

| Host | Package entry point | Explicit invocation | Release evidence |
| --- | --- | --- | --- |
| Codex CLI and desktop | `.codex-plugin/plugin.json` | `$migrate-to-solidrpc` | Skill behavior and plugin structure tested |
| ChatGPT with custom OpenAI plugins | `.codex-plugin/plugin.json` | Select the installed `migrate-to-solidrpc` skill | Packaged, but individual ChatGPT clients and workspace policies are not tested here |
| Claude Code | `.claude-plugin/plugin.json` | `/migrate-to-solidrpc:migrate-to-solidrpc` | Strict manifest validation and local marketplace installation tested |

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

## Requirements

- An EVM application whose repository the agent can inspect, edit, and test.
- Network access to `https://api.solidrpc.io/networks` during qualification.
- A SolidRPC API key exposed through the target project's secret mechanism for authenticated
  qualification and replacement. The skill defaults to `SOLIDRPC_API_KEY` only when the project
  has no established convention.
- Representative tests or safe read-only probes for every route being cut over.

Do not paste an API key into an agent prompt. Put it in an ignored environment file, CI secret, or
secret manager. Server-side clients should use `X-API-Key` with the clean endpoint
`https://rpc.solidrpc.io/evm/{chainId}`.

## Install with Codex

Install the tagged marketplace and plugin from GitHub:

```bash
codex plugin marketplace add SolidRPC/migrate-to-solidrpc --ref v0.1.0
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

Use a checkout of the `v0.1.0` tag when you need a reproducible installation. Other Agent Skills
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

The completed viem example is illustrative. A replacement is qualified for the target application,
chain, method families, historical depth, and runtime boundaries; qualification evidence from one
project must not be reused as a universal cutover token.

## Security and limitations

Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability. Never include credentials in
an issue, pull request, discussion, migration record, or test fixture.

Current release validation covers deterministic routing and qualification-evidence behavior. An
earlier pre-hardening probe covered authenticated Ethereum standard reads and is retained as
endpoint/authentication evidence, not as qualification for the artifact-gated v0.1.0 cutover. No
test qualifies live transaction submission, every trace/debug method, all archive-depth boundaries,
browser-only clients, enhanced APIs, webhooks, or WebSocket subscriptions. Mocks prove routing
invariants rather than production reliability.

The SolidRPC website and migration CTAs are maintained outside this repository. This plugin makes a
direct install path possible, but changing those CTAs is a separate reviewed release.

## License

[MIT](LICENSE)
