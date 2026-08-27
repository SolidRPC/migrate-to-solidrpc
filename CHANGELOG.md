# Changelog

All notable changes to this project are documented in this file.

## [0.1.2] - 2026-08-27

### Changed

- The Codex marketplace now resolves the plugin locally from its tagged checkout, allowing the
  pre-install details page to load the real manifest instead of cross-repository fallback text.
- Added the SolidRPC icon, brand color, website, and clearer migration-focused card and detail
  descriptions.
- Kept the existing migration behavior, qualification gates, sample runtime, and Claude Code
  package unchanged apart from synchronized release metadata.

## [0.1.1] - 2026-08-26

### Added

- A fail-closed capacity qualification gate based on authenticated runtime limit headers,
  measured method-call traffic, batch size, quota demand, retry amplification, and deliberate
  headroom.
- Deterministic coverage for authenticated rate and quota failures, oversized batches, public RPC
  limit errors, and API-key transport selection.
- HMAC-protected qualification evidence, delegated-JWT expiry binding, and sanitized command
  failures that do not echo endpoints, credentials, or signed payloads.
- Exact clean-endpoint enforcement so public/demo aliases cannot masquerade as authenticated
  production qualification.

### Changed

- `X-API-Key` remains preferred, with Bearer API-key authentication documented as a constrained
  fallback and URL authentication retained only for string-only clients.
- Qualification evidence now records limit inputs, probe consumption, the capacity decision, and
  explicit route ownership. Its HMAC invalidates edited evidence or API-key rotation without
  storing the key.
- Delegated-JWT evidence expires before the token's `exp` claim and is invalidated by token
  rotation.
- The viem sample labels its qualified path as partial read replacement and retains writes on the
  legacy route until separate write-scope/account-policy evidence exists.
- Compatibility and installation guidance now distinguishes Codex, Claude Code, ChatGPT, and
  standalone Agent Skills hosts.

## [0.1.0] - 2026-08-26

### Added

- The `migrate-to-solidrpc` skill with fail-closed add and replace modes.
- Live SolidRPC catalog qualification, credential-handling rules, stable-block comparison, and
  exactly-once write safeguards.
- OpenAI/Codex and Claude Code skills-only plugin manifests and GitHub marketplace metadata.
- A deterministic TypeScript/viem sample, untouched source fixture, forward evaluations, and CI
  validation.
- MIT licensing and a private vulnerability-reporting policy.

[0.1.0]: https://github.com/SolidRPC/migrate-to-solidrpc/releases/tag/v0.1.0
[0.1.1]: https://github.com/SolidRPC/migrate-to-solidrpc/releases/tag/v0.1.1
[0.1.2]: https://github.com/SolidRPC/migrate-to-solidrpc/releases/tag/v0.1.2
