import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'
import type { Address, Hash } from 'viem'
import {
  CatalogQualificationError,
  createMigrationApp,
  createQualifiedReplacementApp,
  MissingSolidRpcCredentialError,
  QualificationEvidenceError,
  type MigrationConfig,
} from '../src/index'
import {
  LIVE_ETHEREUM_CATALOG,
  startMockCatalogServer,
  type MockCatalogServer,
  type MockCatalogServerOptions,
} from './mockCatalogServer'
import {
  SAMPLE_RAW_TRANSACTION,
  startMockRpcServer,
  type MockRpcServer,
  type MockRpcServerOptions,
} from './mockRpcServer'

const ADDRESS = '0x000000000000000000000000000000000000dead' as Address
const OTHER_ADDRESS =
  '0x000000000000000000000000000000000000beef' as Address
const SHARED_BLOCK_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hash
const API_KEY = 'test-solidrpc-key'
const NOW = new Date('2026-08-26T12:00:00.000Z')

type Environment = {
  legacy: MockRpcServer
  solidRpc: MockRpcServer
  catalog: MockCatalogServer
  config: MigrationConfig
  evidenceDirectory: string
}

async function startEnvironment(
  context: TestContext,
  options: {
    legacy?: MockRpcServerOptions
    solidRpc?: MockRpcServerOptions
    catalog?: MockCatalogServerOptions
    solidRpcApiKey?: string | undefined
  } = {},
): Promise<Environment> {
  const [legacy, solidRpc, catalog, evidenceDirectory] = await Promise.all([
    startMockRpcServer(options.legacy),
    startMockRpcServer(options.solidRpc),
    startMockCatalogServer(options.catalog),
    mkdtemp(join(tmpdir(), 'solidrpc-qualification-')),
  ])
  context.after(async () => {
    await Promise.all([
      legacy.close(),
      solidRpc.close(),
      catalog.close(),
      rm(evidenceDirectory, { recursive: true, force: true }),
    ])
  })

  return {
    legacy,
    solidRpc,
    catalog,
    evidenceDirectory,
    config: {
      chainId: 1,
      legacyRpcUrl: legacy.url,
      solidRpcUrl: solidRpc.url,
      catalogUrl: catalog.url,
      qualificationFile: join(evidenceDirectory, 'qualification.json'),
      qualificationTtlMs: 60 * 60 * 1_000,
      solidRpcApiKey:
        options.solidRpcApiKey === undefined
          ? API_KEY
          : options.solidRpcApiKey,
      confirmationBlocks: 12n,
      requestTimeoutMs: 1_000,
    },
  }
}

const dependencies = { now: () => NOW }

test('default application traffic always uses only the legacy provider', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { balance: 11n },
    solidRpc: { balance: 22n },
    catalog: { status: 503 },
  })
  const app = createMigrationApp(environment.config, dependencies)

  const result = await app.readBalance(ADDRESS)

  assert.deepEqual(result, {
    provider: 'legacy',
    address: ADDRESS,
    balance: 11n,
  })
  assert.deepEqual(
    environment.legacy.requests.map(({ method }) => method),
    ['eth_getBalance'],
  )
  assert.equal(environment.solidRpc.requests.length, 0)
  assert.equal(environment.catalog.requests, 0)
})

test('comparison validates the live catalog before stable read traffic', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockNumber: 120n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
    solidRpc: {
      blockNumber: 118n,
      blockHash: SHARED_BLOCK_HASH,
      balance: 42n,
    },
  })
  const app = createMigrationApp(environment.config, dependencies)

  const comparison = await app.compareBalance(ADDRESS)
  const productionRead = await app.readBalance(ADDRESS)

  if (comparison.status === 'incomparable') {
    assert.fail('Expected comparable results')
  }
  assert.equal(environment.catalog.requests, 1)
  assert.equal(comparison.status, 'mismatch')
  assert.equal(comparison.blockNumber, 106n)
  assert.equal(comparison.blockHash, SHARED_BLOCK_HASH)
  assert.equal(comparison.productionProvider, 'legacy')
  assert.equal(comparison.productionResult, 41n)
  assert.equal(comparison.legacyResult, 41n)
  assert.equal(comparison.solidRpcResult, 42n)
  assert.equal(productionRead.provider, 'legacy')
  assert.equal(productionRead.balance, 41n)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance'],
  )
  assert.ok(
    environment.solidRpc.requests.every(({ apiKey }) => apiKey === API_KEY),
  )
  assert.ok(
    [...environment.legacy.requests, ...environment.solidRpc.requests].every(
      ({ method }) => method !== 'eth_sendRawTransaction',
    ),
  )
})

for (const scenario of [
  {
    name: 'unavailable',
    catalog: { status: 503 },
    message: /catalog is unavailable/i,
  },
  {
    name: 'unsupported chain',
    catalog: {
      payload: [
        {
          ...LIVE_ETHEREUM_CATALOG[0],
          chainId: 10,
          name: 'Optimism',
        },
      ],
    },
    message: /does not list chain 1/i,
  },
  {
    name: 'malformed',
    catalog: { rawBody: '{not-json' },
    message: /malformed json/i,
  },
] as const) {
  test(`comparison fails closed when the catalog is ${scenario.name}`, async (context) => {
    const environment = await startEnvironment(context, {
      catalog: scenario.catalog,
    })
    const app = createMigrationApp(environment.config, dependencies)

    await assert.rejects(
      app.compareBalance(ADDRESS),
      (error: unknown) =>
        error instanceof CatalogQualificationError &&
        scenario.message.test(error.message),
    )
    assert.equal(environment.catalog.requests, 1)
    assert.equal(environment.legacy.requests.length, 0)
    assert.equal(environment.solidRpc.requests.length, 0)
  })
}

test('catalog validation precedes credential validation and provider traffic', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpcApiKey: '',
  })
  const app = createMigrationApp(environment.config, dependencies)

  await assert.rejects(
    app.compareBalance(ADDRESS),
    MissingSolidRpcCredentialError,
  )
  assert.equal(environment.catalog.requests, 1)
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('qualification writes non-secret evidence and enables SolidRPC-only routing', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockNumber: 120n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
    solidRpc: { blockNumber: 118n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
  })
  const app = createMigrationApp(environment.config, dependencies)

  const qualified = await app.qualifyReplacement(ADDRESS)
  const evidenceText = await readFile(qualified.path, 'utf8')
  assert.equal(qualified.evidence.comparison.legacyResult, '41')
  assert.equal(qualified.evidence.comparison.solidRpcResult, '41')
  assert.equal(qualified.evidence.mode, 'replace')
  assert.deepEqual(qualified.evidence.requiredProjectChecks, {
    routingInvariant: {
      id: 'viem-sample-routing-invariants-v1',
      required: true,
    },
  })
  assert.equal(evidenceText.includes(API_KEY), false)
  assert.equal(evidenceText.includes(environment.legacy.url), false)
  assert.equal(evidenceText.includes('ak_'), false)
  assert.ok(
    [...environment.legacy.requests, ...environment.solidRpc.requests].every(
      ({ method }) => method !== 'eth_sendRawTransaction',
    ),
  )

  const legacyRequestCount = environment.legacy.requests.length
  const solidRpcRequestCount = environment.solidRpc.requests.length
  await environment.legacy.close()

  const replacement = await createQualifiedReplacementApp(
    environment.config,
    ADDRESS,
    dependencies,
  )
  const read = await replacement.readBalance(ADDRESS)

  assert.equal(read.provider, 'solidrpc')
  assert.equal(read.balance, 41n)
  assert.equal(environment.legacy.requests.length, legacyRequestCount)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequestCount + 1)
  assert.equal(
    environment.solidRpc.requests.at(-1)?.method,
    'eth_getBalance',
  )
})

test('replacement fails closed for missing, expired, mismatched, or malformed evidence', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 7n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 7n },
  })
  const missingPath = join(environment.evidenceDirectory, 'missing.json')

  await assert.rejects(
    createQualifiedReplacementApp(
      { ...environment.config, qualificationFile: missingPath },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /missing/i.test(error.message),
  )

  await createMigrationApp(environment.config, dependencies).qualifyReplacement(
    ADDRESS,
  )
  const requestsAfterQualification = environment.solidRpc.requests.length

  await assert.rejects(
    createQualifiedReplacementApp(environment.config, ADDRESS, {
      now: () => new Date(NOW.getTime() + 2 * 60 * 60 * 1_000),
    }),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /expired/i.test(error.message),
  )
  await assert.rejects(
    createQualifiedReplacementApp(
      environment.config,
      OTHER_ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /does not match/i.test(error.message),
  )

  await writeFile(environment.config.qualificationFile!, '{bad-json', 'utf8')
  await assert.rejects(
    createQualifiedReplacementApp(
      environment.config,
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /malformed/i.test(error.message),
  )
  assert.equal(environment.solidRpc.requests.length, requestsAfterQualification)
})

test('replacement activation rejects a missing credential before provider traffic', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
  })
  await createMigrationApp(environment.config, dependencies).qualifyReplacement(
    ADDRESS,
  )
  const legacyRequests = environment.legacy.requests.length
  const solidRpcRequests = environment.solidRpc.requests.length

  await assert.rejects(
    createQualifiedReplacementApp(
      { ...environment.config, solidRpcApiKey: undefined },
      ADDRESS,
      dependencies,
    ),
    MissingSolidRpcCredentialError,
  )
  assert.equal(environment.legacy.requests.length, legacyRequests)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequests)
})

test('replacement rejects wrong-chain, wrong-endpoint, wrong-mode, and tampered check evidence before provider traffic', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 9n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 9n },
  })
  await createMigrationApp(environment.config, dependencies).qualifyReplacement(
    ADDRESS,
  )
  const evidencePath = environment.config.qualificationFile!
  const validEvidence = JSON.parse(
    await readFile(evidencePath, 'utf8'),
  ) as Record<string, unknown>
  const legacyRequests = environment.legacy.requests.length
  const solidRpcRequests = environment.solidRpc.requests.length

  await assert.rejects(
    createQualifiedReplacementApp(
      { ...environment.config, chainId: 10 },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /does not match/i.test(error.message),
  )
  await assert.rejects(
    createQualifiedReplacementApp(
      {
        ...environment.config,
        solidRpcUrl: `${environment.solidRpc.url}/wrong-endpoint`,
      },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /does not match/i.test(error.message),
  )

  await writeFile(
    evidencePath,
    JSON.stringify({ ...validEvidence, mode: 'add' }),
    'utf8',
  )
  await assert.rejects(
    createQualifiedReplacementApp(
      environment.config,
      ADDRESS,
      dependencies,
    ),
    QualificationEvidenceError,
  )

  await writeFile(
    evidencePath,
    JSON.stringify({
      ...validEvidence,
      requiredProjectChecks: {
        routingInvariant: {
          id: 'unrecognized-routing-check',
          required: true,
        },
      },
    }),
    'utf8',
  )
  await assert.rejects(
    createQualifiedReplacementApp(
      environment.config,
      ADDRESS,
      dependencies,
    ),
    QualificationEvidenceError,
  )

  assert.equal(environment.legacy.requests.length, legacyRequests)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequests)
})

test('a mismatch cannot create replacement qualification evidence', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 1n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 2n },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    /requires a matching comparison/i,
  )
  await assert.rejects(readFile(environment.config.qualificationFile!, 'utf8'), {
    code: 'ENOENT',
  })
})

test('signed raw transactions are sent exactly once and are never compared', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 3n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 3n },
  })
  const defaultApp = createMigrationApp(environment.config, dependencies)

  const legacySubmission = await defaultApp.submitSignedTransaction(
    SAMPLE_RAW_TRANSACTION,
  )
  assert.equal(legacySubmission.provider, 'legacy')
  assert.deepEqual(environment.legacy.requests, [
    {
      method: 'eth_sendRawTransaction',
      params: [SAMPLE_RAW_TRANSACTION],
    },
  ])
  assert.equal(environment.solidRpc.requests.length, 0)

  environment.legacy.requests.length = 0
  await defaultApp.qualifyReplacement(ADDRESS)
  environment.legacy.requests.length = 0
  environment.solidRpc.requests.length = 0
  const replacement = await createQualifiedReplacementApp(
    environment.config,
    ADDRESS,
    dependencies,
  )

  const solidRpcSubmission = await replacement.submitSignedTransaction(
    SAMPLE_RAW_TRANSACTION,
  )
  assert.equal(solidRpcSubmission.provider, 'solidrpc')
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(environment.solidRpc.requests, [
    {
      method: 'eth_sendRawTransaction',
      params: [SAMPLE_RAW_TRANSACTION],
      apiKey: API_KEY,
    },
  ])
})

test('comparison stops before reads when providers disagree on the canonical block', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: {
      blockHash:
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
    solidRpc: {
      blockHash:
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
  })
  const app = createMigrationApp(environment.config, dependencies)

  const result = await app.compareBalance(ADDRESS)

  assert.equal(result.status, 'incomparable')
  assert.equal(
    environment.legacy.requests.some(({ method }) => method === 'eth_getBalance'),
    false,
  )
  assert.equal(
    environment.solidRpc.requests.some(({ method }) => method === 'eth_getBalance'),
    false,
  )
})
