# viem provider app (before migration)

This fixture represents a production application before any SolidRPC migration. Runtime
reads and signed transaction submission both use `PRIMARY_RPC_URL`. Block subscriptions
use `PRIMARY_WS_URL`, and `alchemy_getTokenBalances` is an explicit provider-specific API.

The existing deployment telemetry is intentionally discoverable in
`monitoring/rpc-traffic.json`. A migration agent should use it before asking the user for
production inputs. The fixture disables transport retries so an ambiguous signed
transaction response is never submitted again automatically.

```bash
cp .env.example .env
npm ci
npm run typecheck
npm test
npm start -- 0x0000000000000000000000000000000000000000
```
