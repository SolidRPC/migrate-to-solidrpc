# viem provider app (before migration)

This fixture represents an application before any SolidRPC migration. Runtime reads and signed transaction submission both use `PRIMARY_RPC_URL`. Block subscriptions are configured independently through `PRIMARY_WS_URL`.

```bash
cp .env.example .env
npm ci
npm run typecheck
npm test
npm start -- 0x0000000000000000000000000000000000000000
```
