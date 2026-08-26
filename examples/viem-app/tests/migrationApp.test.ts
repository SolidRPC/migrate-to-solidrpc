import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Address, Hash } from 'viem'
import {
  createMigrationApp,
  MissingSolidRpcCredentialError,
  type MigrationConfig,
  type RpcProvider,
} from '../src/index'
import {
  SAMPLE_RAW_TRANSACTION,
  startMockRpcServer,
  type MockRpcServer,
  type MockRpcServerOptions,
} from './mockRpcServer'

const ADDRESS = '0x000000000000000000000000000000000000dead' as Address
const SHARED_BLOCK_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hash
const API_KEY = 'test-solidrpc-key'

async function startProviders(
  context: TestContext,
  legacyOptions: MockRpcServerOptions = {},
  solidRpcOptions: MockRpcServerOptions = {},
): Promise<{ legacy: MockRpcServer; solidRpc: MockRpcServer }> {
  const [legacy, solidRpc] = await Promise.all([
    startMockRpcServer(legacyOptions),
    startMockRpcServer(solidRpcOptions),
  ])
  context.after(async () => {
    await Promise.all([legacy.close(), solidRpc.close()])
  })
  return { legacy, solidRpc }
}

function config(
  providers: { legacy: MockRpcServer; solidRpc: MockRpcServer },
  primaryProvider: RpcProvider = 'legacy',
  solidRpcApiKey: string | undefined = API_KEY,
): MigrationConfig {
  return {
    chainId: 1,
    primaryProvider,
    legacyRpcUrl: providers.legacy.url,
    solidRpcUrl: providers.solidRpc.url,
    solidRpcApiKey,
    confirmationBlocks: 12n,
    requestTimeoutMs: 1_000,
  }
}

test('default production reads use only the existing provider', async (context) => {
  const providers = await startProviders(
    context,
    { balance: 11n },
    { balance: 22n },
  )
  const app = createMigrationApp(config(providers))

  const result = await app.readBalance(ADDRESS)

  assert.deepEqual(result, {
    provider: 'legacy',
    address: ADDRESS,
    balance: 11n,
  })
  assert.deepEqual(
    providers.legacy.requests.map(({ method }) => method),
    ['eth_getBalance'],
  )
  assert.equal(providers.solidRpc.requests.length, 0)
})

test('manual comparison uses a shared stable block and reports a mismatch without changing production reads', async (context) => {
  const providers = await startProviders(
    context,
    { blockNumber: 120n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
    { blockNumber: 118n, blockHash: SHARED_BLOCK_HASH, balance: 42n },
  )
  const app = createMigrationApp(config(providers))

  const comparison = await app.compareBalance(ADDRESS)
  const productionRead = await app.readBalance(ADDRESS)

  if (comparison.status === 'incomparable') {
    assert.fail('Expected comparable results')
  }
  assert.equal(comparison.status, 'mismatch')
  assert.equal(comparison.blockNumber, 106n)
  assert.equal(comparison.blockHash, SHARED_BLOCK_HASH)
  assert.equal(comparison.productionProvider, 'legacy')
  assert.equal(comparison.productionResult, 41n)
  assert.equal(comparison.legacyResult, 41n)
  assert.equal(comparison.solidRpcResult, 42n)
  assert.equal(productionRead.provider, 'legacy')
  assert.equal(productionRead.balance, 41n)

  const legacyComparisonCalls = providers.legacy.requests.slice(0, 3)
  const solidRpcComparisonCalls = providers.solidRpc.requests
  assert.deepEqual(
    legacyComparisonCalls.map(({ method }) => method),
    ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance'],
  )
  assert.deepEqual(
    solidRpcComparisonCalls.map(({ method }) => method),
    ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance'],
  )
  assert.equal(
    legacyComparisonCalls.find(({ method }) => method === 'eth_getBlockByNumber')
      ?.params[0],
    '0x6a',
  )
  assert.equal(
    solidRpcComparisonCalls.find(({ method }) => method === 'eth_getBalance')
      ?.params[1],
    '0x6a',
  )
  assert.ok(solidRpcComparisonCalls.every(({ apiKey }) => apiKey === API_KEY))
  assert.ok(
    [...legacyComparisonCalls, ...solidRpcComparisonCalls].every(
      ({ method }) => method !== 'eth_sendRawTransaction',
    ),
  )
})

test('replacement mode sends normal traffic only to SolidRPC', async (context) => {
  const providers = await startProviders(
    context,
    { balance: 11n },
    { balance: 22n },
  )
  const app = createMigrationApp(config(providers, 'solidrpc'))

  const result = await app.readBalance(ADDRESS)

  assert.equal(result.provider, 'solidrpc')
  assert.equal(result.balance, 22n)
  assert.equal(providers.legacy.requests.length, 0)
  assert.deepEqual(providers.solidRpc.requests, [
    { method: 'eth_getBalance', params: [ADDRESS, 'latest'], apiKey: API_KEY },
  ])
})

test('signed raw transactions are sent exactly once to the selected provider', async (context) => {
  const providers = await startProviders(context)
  const legacyApp = createMigrationApp(config(providers, 'legacy'))

  const legacySubmission = await legacyApp.submitSignedTransaction(
    SAMPLE_RAW_TRANSACTION,
  )

  assert.equal(legacySubmission.provider, 'legacy')
  assert.deepEqual(providers.legacy.requests, [
    {
      method: 'eth_sendRawTransaction',
      params: [SAMPLE_RAW_TRANSACTION],
    },
  ])
  assert.equal(providers.solidRpc.requests.length, 0)

  providers.legacy.requests.length = 0
  const solidRpcApp = createMigrationApp(config(providers, 'solidrpc'))
  const solidRpcSubmission = await solidRpcApp.submitSignedTransaction(
    SAMPLE_RAW_TRANSACTION,
  )

  assert.equal(solidRpcSubmission.provider, 'solidrpc')
  assert.equal(providers.legacy.requests.length, 0)
  assert.deepEqual(providers.solidRpc.requests, [
    {
      method: 'eth_sendRawTransaction',
      params: [SAMPLE_RAW_TRANSACTION],
      apiKey: API_KEY,
    },
  ])
})

test('missing SolidRPC credentials cannot trigger comparison or replacement traffic', async (context) => {
  const providers = await startProviders(context, { balance: 9n }, { balance: 99n })
  const withoutCredential = {
    ...config(providers),
    solidRpcApiKey: undefined,
  }
  const addModeApp = createMigrationApp(withoutCredential)

  const legacyResult = await addModeApp.readBalance(ADDRESS)
  assert.equal(legacyResult.balance, 9n)
  await assert.rejects(
    addModeApp.compareBalance(ADDRESS),
    MissingSolidRpcCredentialError,
  )
  assert.throws(
    () =>
      createMigrationApp({
        ...withoutCredential,
        primaryProvider: 'solidrpc',
      }),
    MissingSolidRpcCredentialError,
  )

  assert.deepEqual(
    providers.legacy.requests.map(({ method }) => method),
    ['eth_getBalance'],
  )
  assert.equal(providers.solidRpc.requests.length, 0)
})

test('comparison stops when providers disagree on the canonical block', async (context) => {
  const providers = await startProviders(
    context,
    {
      blockHash:
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
    {
      blockHash:
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
  )
  const app = createMigrationApp(config(providers))

  const result = await app.compareBalance(ADDRESS)

  assert.equal(result.status, 'incomparable')
  assert.equal(
    providers.legacy.requests.some(({ method }) => method === 'eth_getBalance'),
    false,
  )
  assert.equal(
    providers.solidRpc.requests.some(({ method }) => method === 'eth_getBalance'),
    false,
  )
})
