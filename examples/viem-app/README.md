# viem migration example

This small TypeScript app shows the safe result of adding SolidRPC to an existing viem integration. Normal traffic keeps using the legacy provider by default. SolidRPC is contacted only by the explicit comparison command until you select replacement mode.

## Configure

```sh
npm ci
cp .env.example .env
```

Set `LEGACY_RPC_URL`, `SOLIDRPC_API_KEY`, `CHAIN_ID`, and `ACCOUNT_ADDRESS`. The SolidRPC client sends the key in the `X-API-Key` header to `https://rpc.solidrpc.io/evm/{chainId}`; credentials never belong in source code.

## Run

```sh
npm run app
npm run rpc:compare
```

`npm run app` performs one production balance read. With the default `RPC_PRIMARY=legacy`, it does not contact SolidRPC. `npm run rpc:compare` explicitly reads both providers at the same confirmed block, verifies the block hash, and reports `match`, `mismatch`, or `incomparable`. A mismatch exits with status 2 and never changes the production result.

After the chain and method coverage has been qualified, set `RPC_PRIMARY=solidrpc` to route normal reads and signed raw transactions exclusively to SolidRPC. Keep `LEGACY_RPC_URL` configured for rollback, but it remains inactive during normal replacement-mode traffic.

The exported `submitSignedTransaction(serializedTransaction)` path sends an already-signed transaction exactly once to the selected primary. Comparisons are deliberately read-only and never mirror writes.

## Verify

```sh
npm run typecheck
npm test
```

The tests use ephemeral local JSON-RPC servers. They need no live credentials or network access and assert routing, headers, stable-block comparison, mismatch behavior, transaction safety, and credential failure behavior.
