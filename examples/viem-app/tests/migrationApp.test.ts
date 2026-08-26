import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { test, type TestContext } from 'node:test'
import type { Address, Hash } from 'viem'
import {
  CapacityQualificationError,
  CatalogQualificationError,
  classifySolidRpcLimitResponse,
  ConfigurationError,
  createMigrationApp,
  createQualifiedReadReplacementApp,
  formatCommandError,
  loadMigrationConfig,
  MissingCapacityProfileError,
  MissingSolidRpcCredentialError,
  QualificationEvidenceError,
  resolveSolidRpcAuthentication,
  type CapacityTrafficProfile,
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
const NOW = new Date('2026-08-26T12:00:00.000Z')
const API_KEY = `ak_${'0'.repeat(64)}`
const OTHER_API_KEY = `ak_${'1'.repeat(64)}`

function testJwt(exp: number, subject: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp, sub: subject })}.test-signature-${subject}`
}

const CUSTOMER_JWT_EXPIRY = Math.floor(NOW.getTime() / 1_000) + 3_600
const CUSTOMER_JWT = testJwt(CUSTOMER_JWT_EXPIRY, 'qualified')
const OTHER_CUSTOMER_JWT = testJwt(CUSTOMER_JWT_EXPIRY, 'different')
const CAPACITY_PROFILE: CapacityTrafficProfile = {
  largestValidMethodBatch: 2,
  sustainedMethodCallsPerSecond: 10,
  peakMethodCallsPerSecond: 20,
  responseUnitsPerQuotaWindow: { day: 1_000, month: 30_000 },
  sharedTraffic: {
    sustainedMethodCallsPerSecond: 2,
    peakMethodCallsPerSecond: 4,
    responseUnitsPerQuotaWindow: { day: 200, month: 6_000 },
  },
  retryAmplificationFactor: 1.1,
  headroomPercent: 20,
}

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
    capacityTrafficProfile?: CapacityTrafficProfile | null
    solidRpcApiKeyTransport?: 'x-api-key' | 'bearer'
    solidRpcCustomerAuthorization?: string
    solidRpcCustomerAuthorizationRequired?: boolean
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
      solidRpcApiKeyTransport:
        options.solidRpcApiKeyTransport ?? 'x-api-key',
      ...(options.solidRpcCustomerAuthorization === undefined
        ? {}
        : {
            solidRpcCustomerAuthorization:
              options.solidRpcCustomerAuthorization,
          }),
      solidRpcCustomerAuthorizationRequired:
        options.solidRpcCustomerAuthorizationRequired ?? false,
      capacityTrafficProfile:
        options.capacityTrafficProfile === null
          ? undefined
          : (options.capacityTrafficProfile ?? CAPACITY_PROFILE),
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
    capacityTrafficProfile: null,
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

test('qualification writes non-secret evidence and enables SolidRPC-only qualified reads', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockNumber: 120n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
    solidRpc: { blockNumber: 118n, blockHash: SHARED_BLOCK_HASH, balance: 41n },
  })
  const app = createMigrationApp(environment.config, dependencies)

  const qualified = await app.qualifyReplacement(ADDRESS)
  const evidenceText = await readFile(qualified.path, 'utf8')
  assert.equal(qualified.evidence.comparison.legacyResult, '41')
  assert.equal(qualified.evidence.comparison.solidRpcResult, '41')
  assert.equal(qualified.evidence.mode, 'partial-read-replace')
  assert.equal(qualified.evidence.schemaVersion, 2)
  assert.deepEqual(qualified.evidence.requiredProjectChecks, {
    routingInvariant: {
      id: 'viem-sample-partial-read-routing-invariants-v3',
      required: true,
      solidRpcOnlyMethods: ['eth_getBalance'],
      retainedLegacyMethods: ['eth_sendRawTransaction'],
    },
  })
  assert.equal(qualified.evidence.capacity.status, 'qualified')
  assert.equal(qualified.evidence.capacity.apiKeyTransport, 'x-api-key')
  assert.deepEqual(qualified.evidence.probeUsage, {
    rpcRequests: 4,
    methodCalls: 4,
    responseUnits: 4,
  })
  assert.equal(evidenceText.includes(API_KEY), false)
  assert.equal(evidenceText.includes(environment.legacy.url), false)
  assert.equal(evidenceText.includes('ak_'), false)
  assert.ok(
    [...environment.legacy.requests, ...environment.solidRpc.requests].every(
      ({ method }) => method !== 'eth_sendRawTransaction',
    ),
  )
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    [
      'eth_chainId',
      'eth_blockNumber',
      'eth_getBlockByNumber',
      'eth_getBalance',
    ],
  )

  const legacyRequestCount = environment.legacy.requests.length
  const solidRpcRequestCount = environment.solidRpc.requests.length
  await environment.legacy.close()

  const replacement = await createQualifiedReadReplacementApp(
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
    createQualifiedReadReplacementApp(
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
    createQualifiedReadReplacementApp(environment.config, ADDRESS, {
      now: () => new Date(NOW.getTime() + 2 * 60 * 60 * 1_000),
    }),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /expired/i.test(error.message),
  )
  await assert.rejects(
    createQualifiedReadReplacementApp(
      environment.config,
      OTHER_ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /does not match/i.test(error.message),
  )

  await writeFile(environment.config.qualificationFile!, '{bad-json', 'utf8')
  await assert.rejects(
    createQualifiedReadReplacementApp(
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
    createQualifiedReadReplacementApp(
      { ...environment.config, solidRpcApiKey: undefined },
      ADDRESS,
      dependencies,
    ),
    MissingSolidRpcCredentialError,
  )
  assert.equal(environment.legacy.requests.length, legacyRequests)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequests)
})

test('replacement evidence is bound to the qualified API key and customer JWT', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpcCustomerAuthorization: `Bearer ${CUSTOMER_JWT}`,
    solidRpcCustomerAuthorizationRequired: true,
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
  })
  await createMigrationApp(environment.config, dependencies).qualifyReplacement(
    ADDRESS,
  )
  const legacyRequests = environment.legacy.requests.length
  const solidRpcRequests = environment.solidRpc.requests.length

  await assert.rejects(
    createQualifiedReadReplacementApp(
      { ...environment.config, solidRpcApiKey: OTHER_API_KEY },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /does not match/i.test(error.message),
  )
  await assert.rejects(
    createQualifiedReadReplacementApp(
      {
        ...environment.config,
        solidRpcCustomerAuthorization: `Bearer ${OTHER_CUSTOMER_JWT}`,
      },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /does not match/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, legacyRequests)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequests)
})

test('replacement activation rejects evidence whose signed payload was edited', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
  })
  await createMigrationApp(environment.config, dependencies).qualifyReplacement(
    ADDRESS,
  )
  const evidencePath = environment.config.qualificationFile!
  const evidence = JSON.parse(
    await readFile(evidencePath, 'utf8'),
  ) as Record<string, unknown>
  const catalog = evidence.catalog as Record<string, unknown>
  const legacyRequests = environment.legacy.requests.length
  const solidRpcRequests = environment.solidRpc.requests.length
  await writeFile(
    evidencePath,
    JSON.stringify({
      ...evidence,
      catalog: { ...catalog, name: 'Tampered network name' },
    }),
    'utf8',
  )

  await assert.rejects(
    createQualifiedReadReplacementApp(
      environment.config,
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /integrity/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, legacyRequests)
  assert.equal(environment.solidRpc.requests.length, solidRpcRequests)
})

test('customer JWT expiry bounds qualification evidence with a safety margin', async (context) => {
  const jwtExpirySeconds = Math.floor(NOW.getTime() / 1_000) + 120
  const environment = await startEnvironment(context, {
    solidRpcCustomerAuthorization: `Bearer ${testJwt(jwtExpirySeconds, 'short')}`,
    solidRpcCustomerAuthorizationRequired: true,
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 8n },
  })

  const { evidence } = await createMigrationApp(
    environment.config,
    dependencies,
  ).qualifyReplacement(ADDRESS)
  const jwtExpiry = new Date(jwtExpirySeconds * 1_000)
  assert.equal(
    evidence.credentialBinding.customerJwtExpiresAt,
    jwtExpiry.toISOString(),
  )
  assert.equal(evidence.credentialBinding.safetySkewSeconds, 30)
  assert.equal(
    evidence.expiresAt,
    new Date(jwtExpiry.getTime() - 30_000).toISOString(),
  )

  await assert.rejects(
    createQualifiedReadReplacementApp(environment.config, ADDRESS, {
      now: () => new Date(jwtExpiry.getTime() - 30_000),
    }),
    (error: unknown) =>
      error instanceof QualificationEvidenceError && /expired/i.test(error.message),
  )
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
    createQualifiedReadReplacementApp(
      { ...environment.config, chainId: 10 },
      ADDRESS,
      dependencies,
    ),
    (error: unknown) =>
      error instanceof QualificationEvidenceError &&
      /does not match/i.test(error.message),
  )
  await assert.rejects(
    createQualifiedReadReplacementApp(
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
    createQualifiedReadReplacementApp(
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
    createQualifiedReadReplacementApp(
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
  const replacement = await createQualifiedReadReplacementApp(
    environment.config,
    ADDRESS,
    dependencies,
  )

  const legacyReplacementSubmission = await replacement.submitSignedTransaction(
    SAMPLE_RAW_TRANSACTION,
  )
  assert.equal(legacyReplacementSubmission.provider, 'legacy')
  assert.deepEqual(environment.legacy.requests, [
    {
      method: 'eth_sendRawTransaction',
      params: [SAMPLE_RAW_TRANSACTION],
    },
  ])
  assert.equal(environment.solidRpc.requests.length, 0)
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

test('replacement qualification requires an explicit measured capacity profile', async (context) => {
  const environment = await startEnvironment(context, {
    capacityTrafficProfile: null,
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    MissingCapacityProfileError,
  )
  assert.equal(environment.catalog.requests, 1)
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('default and comparison configuration ignore an unfinished replacement capacity profile', () => {
  const environment = {
    LEGACY_RPC_URL: 'https://legacy.example',
    RPC_LARGEST_VALID_METHOD_BATCH: '10',
  }

  assert.equal(
    loadMigrationConfig(environment).capacityTrafficProfile,
    undefined,
  )
  assert.throws(
    () =>
      loadMigrationConfig(environment, { includeCapacityProfile: true }),
    (error: unknown) =>
      error instanceof ConfigurationError && /incomplete/i.test(error.message),
  )
})

test('replacement qualification fails closed when live limits cannot fit the traffic profile', async (context) => {
  const environment = await startEnvironment(context, {
    capacityTrafficProfile: {
      ...CAPACITY_PROFILE,
      largestValidMethodBatch: 10,
    },
    solidRpc: {
      responseHeaders: {
        'X-RateLimit-Burst': '5',
        'X-RateLimit-Remaining': '4',
      },
    },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /batch.*burst limit/i.test(error.message),
  )
  assert.equal(environment.catalog.requests, 1)
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('replacement qualification compares instantaneous peak traffic to the live rate limit', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpc: {
      responseHeaders: {
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Burst': '1000',
        'X-RateLimit-Remaining': '999',
      },
    },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /peak.*live rate capacity/i.test(error.message),
  )
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('replacement qualification fails closed when the authenticated route serves another chain', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpc: { chainId: 10 },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /wrong chain ID/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('replacement qualification fails closed when authenticated limit headers are missing', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpc: { omitLimitHeaders: true },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /header/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('replacement qualification derives the quota window from live headers and blocks insufficient quota', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpc: {
      responseHeaders: {
        'X-Quota-Limit': '35000',
        'X-Quota-Window': 'month',
        'X-Quota-Used': '100',
        'X-Quota-Remaining': '34900',
        'X-Quota-Reset': '43200',
      },
    },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /projected response units.*live quota/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('replacement qualification preserves quota headroom against current usage', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpc: {
      responseHeaders: {
        'X-Quota-Limit': '1000000',
        'X-Quota-Window': 'day',
        'X-Quota-Used': '799990',
        'X-Quota-Remaining': '200010',
        'X-Quota-Reset': '600',
      },
    },
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof CapacityQualificationError &&
      /before reset.*headroom/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.deepEqual(
    environment.solidRpc.requests.map(({ method }) => method),
    ['eth_chainId'],
  )
})

test('capacity evidence records expanded shared traffic, probe cost, and quota-bound expiry', async (context) => {
  const environment = await startEnvironment(context, {
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 5n },
    solidRpc: {
      blockHash: SHARED_BLOCK_HASH,
      balance: 5n,
      responseHeaders: { 'X-Quota-Reset': '600' },
    },
  })

  const { evidence } = await createMigrationApp(
    environment.config,
    dependencies,
  ).qualifyReplacement(ADDRESS)

  assert.ok(
    Math.abs(
      evidence.capacity.calculated.sustainedMethodCallsPerSecond - 13.2,
    ) < Number.EPSILON * 10,
  )
  assert.ok(
    Math.abs(evidence.capacity.calculated.peakMethodCallsPerSecond - 26.4) <
      Number.EPSILON * 20,
  )
  assert.equal(evidence.capacity.calculated.responseUnitsPerQuotaWindow, 1320)
  assert.deepEqual(evidence.capacity.probeUsage, {
    rpcRequests: 1,
    methodCalls: 1,
    responseUnits: 1,
  })
  assert.equal(
    evidence.expiresAt,
    new Date(NOW.getTime() + 600_000).toISOString(),
  )
})

test('Bearer API-key fallback authenticates without an X-API-Key header', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpcApiKeyTransport: 'bearer',
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 6n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 6n },
  })

  const { evidence } = await createMigrationApp(
    environment.config,
    dependencies,
  ).qualifyReplacement(ADDRESS)

  assert.equal(evidence.capacity.apiKeyTransport, 'bearer')
  assert.ok(
    environment.solidRpc.requests.every(
      ({ apiKey, authorization }) =>
        apiKey === undefined && authorization === `Bearer ${API_KEY}`,
    ),
  )
})

test('Bearer API-key fallback is rejected when Authorization is reserved for a customer JWT', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpcApiKeyTransport: 'bearer',
    solidRpcCustomerAuthorization: `Bearer ${CUSTOMER_JWT}`,
    solidRpcCustomerAuthorizationRequired: true,
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof ConfigurationError && /customer JWT/i.test(error.message),
  )
  assert.equal(environment.catalog.requests, 1)
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('X-API-Key remains compatible with a separate customer JWT', async (context) => {
  const customerAuthorization = `Bearer ${CUSTOMER_JWT}`
  const environment = await startEnvironment(context, {
    solidRpcCustomerAuthorization: customerAuthorization,
    solidRpcCustomerAuthorizationRequired: true,
    legacy: { blockHash: SHARED_BLOCK_HASH, balance: 6n },
    solidRpc: { blockHash: SHARED_BLOCK_HASH, balance: 6n },
  })

  const { path } = await createMigrationApp(
    environment.config,
    dependencies,
  ).qualifyReplacement(ADDRESS)

  assert.ok(
    environment.solidRpc.requests.every(
      ({ apiKey, authorization }) =>
        apiKey === API_KEY && authorization === customerAuthorization,
    ),
  )
  const evidence = await readFile(path, 'utf8')
  assert.equal(evidence.includes(API_KEY), false)
  assert.equal(evidence.includes(CUSTOMER_JWT), false)
})

test('qualification rejects a second API-key transport in the URL', async (context) => {
  const environment = await startEnvironment(context)
  const config = {
    ...environment.config,
    solidRpcUrl: `${environment.solidRpc.url}/${API_KEY}`,
  }

  await assert.rejects(
    createMigrationApp(config, dependencies).qualifyReplacement(ADDRESS),
    (error: unknown) =>
      error instanceof ConfigurationError && /URL authentication/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('qualification rejects a percent-encoded API key in the URL', async (context) => {
  const environment = await startEnvironment(context)
  const encodedApiKey = `%61k_${'0'.repeat(64)}`

  await assert.rejects(
    createMigrationApp(
      {
        ...environment.config,
        solidRpcUrl: `${environment.solidRpc.url}/${encodedApiKey}`,
      },
      dependencies,
    ).qualifyReplacement(ADDRESS),
    (error: unknown) =>
      error instanceof ConfigurationError && /URL authentication/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('authenticated configuration rejects official public and demo aliases', () => {
  const baseConfig: MigrationConfig = {
    chainId: 1,
    legacyRpcUrl: 'https://legacy.example',
    solidRpcApiKey: API_KEY,
  }
  assert.doesNotThrow(() =>
    resolveSolidRpcAuthentication({
      ...baseConfig,
      solidRpcUrl: 'https://rpc.solidrpc.io/evm/1',
    }),
  )

  for (const solidRpcUrl of [
    'https://rpc.solidrpc.io/public/evm/1',
    'https://rpc.solidrpc.io/demo/evm/1',
    'https://rpc.solidrpc.io/%70ublic/evm/1',
  ]) {
    assert.throws(
      () =>
        resolveSolidRpcAuthentication({
          ...baseConfig,
          solidRpcUrl,
        }),
      (error: unknown) =>
        error instanceof ConfigurationError && /clean endpoint/i.test(error.message),
    )
  }
})

test('qualification rejects the API key duplicated across authentication headers', async (context) => {
  const environment = await startEnvironment(context, {
    solidRpcCustomerAuthorization: `Bearer ${API_KEY}`,
  })

  await assert.rejects(
    createMigrationApp(environment.config, dependencies).qualifyReplacement(
      ADDRESS,
    ),
    (error: unknown) =>
      error instanceof ConfigurationError &&
      /both X-API-Key and Authorization/i.test(error.message),
  )
  assert.equal(environment.legacy.requests.length, 0)
  assert.equal(environment.solidRpc.requests.length, 0)
})

test('limit classification marks recoverable authenticated 429 responses', () => {
  assert.deepEqual(
    classifySolidRpcLimitResponse({
      status: 429,
      headers: { 'Retry-After': '2', 'X-RateLimit-Burst': '10' },
      body: { error: 'Rate limit exceeded', requiredTokens: 1 },
    }),
    {
      kind: 'recoverable-rate-limit',
      productionEligible: false,
      retryAfterSeconds: 2,
      action: 'wait-before-retrying-read',
    },
  )
})

test('limit classification requires an oversized batch to be reduced rather than retried', () => {
  assert.deepEqual(
    classifySolidRpcLimitResponse({
      status: 429,
      headers: { 'X-RateLimit-Burst': '10' },
      body: { error: 'Rate limit exceeded', requiredTokens: 11 },
    }),
    {
      kind: 'oversized-batch',
      productionEligible: false,
      requiredTokens: 11,
      burst: 10,
      action: 'reduce-or-split-read-batch',
    },
  )
})

test('an oversized batch is not retryable even when Retry-After is present', () => {
  assert.equal(
    classifySolidRpcLimitResponse({
      status: 429,
      headers: { 'Retry-After': '2', 'X-RateLimit-Burst': '10' },
      body: { error: 'Rate limit exceeded', requiredTokens: 11 },
    }).kind,
    'oversized-batch',
  )
})

test('limit classification treats authenticated 402 as quota exhaustion with reset evidence', () => {
  assert.deepEqual(
    classifySolidRpcLimitResponse({
      status: 402,
      headers: { 'X-Quota-Reset': '3600' },
      body: { error: 'Monthly response quota exceeded' },
    }),
    {
      kind: 'quota-exhausted',
      productionEligible: false,
      resetSeconds: 3600,
      action: 'wait-for-reset-or-upgrade',
    },
  )
})

test('limit classification never treats public -32005 traffic as production qualification', () => {
  assert.deepEqual(
    classifySolidRpcLimitResponse({
      status: 429,
      headers: { 'Retry-After': '1' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32005,
          message: 'Public RPC rate limit exceeded',
          data: { reason: 'rate_limit' },
        },
      },
    }),
    {
      kind: 'public-limit',
      productionEligible: false,
      reason: 'rate_limit',
      retryAfterSeconds: 1,
      action: 'do-not-use-public-traffic-for-production-qualification',
    },
  )
})

test('limit classification rejects a JSON-RPC error carried by HTTP 200', () => {
  assert.deepEqual(
    classifySolidRpcLimitResponse({
      status: 200,
      headers: {},
      body: {
        jsonrpc: '2.0',
        id: 'solidrpc-capacity-qualification',
        error: { code: -32000, message: 'upstream unavailable' },
      },
    }),
    {
      kind: 'other-error',
      productionEligible: false,
      status: 200,
      action: 'stop-and-investigate-response',
    },
  )
})

test('command errors redact endpoints, credentials, JWTs, and signed payloads', () => {
  const legacyUrl = `https://user:secret@legacy.example/rpc?key=${API_KEY}`
  const rawTransaction = `0x${'ab'.repeat(64)}`
  const formatted = formatCommandError(
    new Error(
      `request ${legacyUrl} key ${API_KEY} auth Bearer ${CUSTOMER_JWT} tx ${rawTransaction}\nprivate stack detail`,
    ),
  )

  assert.match(formatted, /\[redacted-url\]/)
  assert.equal(formatted.includes(legacyUrl), false)
  assert.equal(formatted.includes(API_KEY), false)
  assert.equal(formatted.includes(CUSTOMER_JWT), false)
  assert.equal(formatted.includes(rawTransaction), false)
  assert.equal(formatted.includes('private stack detail'), false)
})
