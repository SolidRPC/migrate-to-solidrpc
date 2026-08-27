import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Address, Hex } from 'viem'
import {
  applyQualifiedLocalChange,
  classifyApplication,
  providerSpecificBoundary,
  qualifyMigration,
  runPrototypeSmoke,
  SolidRpc,
  websocketBoundary,
  type ProductionEvidenceSource,
  type ProductionFacts,
  type SolidRpcConfig,
} from '../src/index'
import {
  createAdvancedCandidateEvidence,
  selectAdvancedDualRoute,
} from '../src/advanced/evidence'
import { startMockCatalogServer } from './mockCatalogServer'
import {
  SAMPLE_RAW_TRANSACTION,
  startMockRpcServer,
} from './mockRpcServer'

const ADDRESS = '0x0000000000000000000000000000000000000000' as Address
const API_KEY = 'test-secret-api-key-that-must-never-appear'
const PROJECT_DIR = fileURLToPath(new URL('..', import.meta.url))

async function environment(
  context: TestContext,
  options: {
    explicitRepositoryLimits?: SolidRpcConfig['explicitRepositoryLimits']
    rpc?: Parameters<typeof startMockRpcServer>[0]
    catalog?: Parameters<typeof startMockCatalogServer>[0]
  } = {},
): Promise<{
  config: SolidRpcConfig
  rpc: Awaited<ReturnType<typeof startMockRpcServer>>
  catalog: Awaited<ReturnType<typeof startMockCatalogServer>>
}> {
  const [rpc, catalog] = await Promise.all([
    startMockRpcServer(options.rpc),
    startMockCatalogServer(options.catalog),
  ])
  context.after(async () => Promise.all([rpc.close(), catalog.close()]))
  return {
    rpc,
    catalog,
    config: {
      chainId: 1,
      rpcUrl: rpc.url,
      catalogUrl: catalog.url,
      apiKey: API_KEY,
      apiKeyReference: 'SOLIDRPC_API_KEY',
      accountAddress: ADDRESS,
      requestTimeoutMs: 1_000,
      explicitRepositoryLimits: options.explicitRepositoryLimits ?? {},
    },
  }
}

const PRODUCTION_FACTS: ProductionFacts = {
  peakRequestsPerSecond: 80,
  quotaWindowUsage: 250_000,
  largestBatch: 25,
  requiredNetworks: [1],
  methodFamilies: ['standard'],
  oldestRequiredBlock: 19_000_000n,
  timeoutMilliseconds: 8_000,
  ambiguousWritePolicy: 'never-retry',
}

function completeProductionSources(): ProductionEvidenceSource[] {
  return [
    {
      source: 'monitoring/rpc-dashboard.json',
      facts: {
        peakRequestsPerSecond: PRODUCTION_FACTS.peakRequestsPerSecond,
        quotaWindowUsage: PRODUCTION_FACTS.quotaWindowUsage,
        largestBatch: PRODUCTION_FACTS.largestBatch,
      },
    },
    {
      source: 'infra/runtime-config.yaml',
      facts: {
        requiredNetworks: PRODUCTION_FACTS.requiredNetworks,
        methodFamilies: PRODUCTION_FACTS.methodFamilies,
        oldestRequiredBlock: PRODUCTION_FACTS.oldestRequiredBlock,
        timeoutMilliseconds: PRODUCTION_FACTS.timeoutMilliseconds,
        ambiguousWritePolicy: PRODUCTION_FACTS.ambiguousWritePolicy,
      },
    },
  ]
}

test('a telemetry-free prototype completes through the authenticated fast path', async (context) => {
  const current = await environment(context)
  const smoke = await runPrototypeSmoke(current.config)
  const decision = qualifyMigration({ applicationClass: 'prototype' })

  assert.equal(smoke.status, 'qualified')
  assert.equal(smoke.productionCapacityProven, false)
  assert.deepEqual(smoke.planLimits, {
    ratePerSecond: 100,
    burst: 200,
    remaining: 199,
    rateResetSeconds: 1,
    quotaLimit: 1_000_000,
    quotaWindow: 'day',
    quotaUsed: 1,
    quotaRemaining: 999_999,
    quotaResetSeconds: 43_200,
  })
  assert.equal(decision.status, 'qualified')
  assert.deepEqual(decision.discoveredFrom, [])
  assert.deepEqual(
    current.rpc.requests.map(({ method }) => method),
    ['eth_chainId', 'eth_blockNumber', 'eth_getBalance'],
  )
  assert.deepEqual(current.rpc.requests[2]?.params, [ADDRESS, '0x58'])
  assert.ok(current.rpc.requests.every(({ apiKey }) => apiKey === API_KEY))
  assert.equal(current.catalog.requests(), 1)
})

test('production telemetry is discovered automatically without asking a question', () => {
  assert.equal(
    classifyApplication({ productionSignals: ['production deployment', 'alerts'] }),
    'production',
  )
  const decision = qualifyMigration({
    applicationClass: 'production',
    evidenceSources: completeProductionSources(),
  })

  assert.equal(decision.status, 'qualified')
  assert.deepEqual(decision.questions, [])
  assert.deepEqual(decision.discoveredFrom, [
    'monitoring/rpc-dashboard.json',
    'infra/runtime-config.yaml',
  ])
  assert.equal(decision.routing.activeCompatibleRoute, 'solidrpc')
})

test('missing production facts produce exactly one consolidated question', () => {
  const decision = qualifyMigration({
    applicationClass: 'production',
    evidenceSources: [
      {
        source: 'monitoring/partial.json',
        facts: { peakRequestsPerSecond: 50 },
      },
    ],
  })

  assert.equal(decision.status, 'needs-input')
  assert.equal(decision.questions.length, 1)
  const question = decision.questions[0]
  for (const phrase of [
    'quota-window usage',
    'largest JSON-RPC batch',
    'required network chain IDs',
    'required method families',
    'oldest required historical block',
    'request timeout behavior',
    'ambiguous-write retry behavior',
  ]) {
    assert.match(question, new RegExp(phrase, 'i'))
  }
  assert.equal(decision.routing.applyLocalChange, false)
})

test('the default app has no HMAC, runtime evidence, startup gate, or selector', async () => {
  const sourceRoot = join(PROJECT_DIR, 'src')
  const paths = (await readdir(sourceRoot, { recursive: true }))
    .filter((path) => path.endsWith('.ts') && !path.startsWith('advanced/'))
  const normalSource = (
    await Promise.all(paths.map((path) => readFile(join(sourceRoot, path), 'utf8')))
  ).join('\n')
  const packageJson = JSON.parse(
    await readFile(join(PROJECT_DIR, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }

  assert.doesNotMatch(
    normalSource,
    /createHmac|qualificationFile|["']\.solidrpc\/|signed evidence|startup gate/i,
  )
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((name) => name.startsWith('app') || name.startsWith('rpc:')),
    ['app', 'rpc:smoke'],
  )
})

test('the default flow does not create SOLIDRPC_MIGRATION.md', async (context) => {
  const current = await environment(context)
  await runPrototypeSmoke(current.config)
  await assert.rejects(access(join(PROJECT_DIR, 'SOLIDRPC_MIGRATION.md')), {
    code: 'ENOENT',
  })
})

test('expired or edited advanced evidence cannot disable the rollback route', () => {
  const evidence = createAdvancedCandidateEvidence({
    configurationFingerprint: 'candidate-v1',
    signingSecret: 'advanced-test-signing-secret',
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
  })
  const existingRollbackRoute = () => 'existing route is operational'
  const candidateRoute = () => 'candidate route'
  const expired = selectAdvancedDualRoute({
    existingRollbackRoute,
    solidRpcCandidateRoute: candidateRoute,
    evidence,
    expectedFingerprint: 'candidate-v1',
    signingSecret: 'advanced-test-signing-secret',
    now: new Date('2026-01-03T00:00:00.000Z'),
  })
  const edited = selectAdvancedDualRoute({
    existingRollbackRoute,
    solidRpcCandidateRoute: candidateRoute,
    evidence: { ...evidence, configurationFingerprint: 'edited' },
    expectedFingerprint: 'candidate-v1',
    signingSecret: 'advanced-test-signing-secret',
    now: new Date('2026-01-01T12:00:00.000Z'),
  })
  const missing = selectAdvancedDualRoute({
    existingRollbackRoute,
    solidRpcCandidateRoute: candidateRoute,
    expectedFingerprint: 'candidate-v1',
    signingSecret: 'advanced-test-signing-secret',
    now: new Date('2026-01-01T12:00:00.000Z'),
  })
  const invalid = selectAdvancedDualRoute({
    existingRollbackRoute,
    solidRpcCandidateRoute: candidateRoute,
    evidence,
    expectedFingerprint: 'candidate-v1',
    signingSecret: 'wrong-secret',
    now: new Date('2026-01-01T12:00:00.000Z'),
  })

  assert.equal(expired.active, 'existing-rollback')
  assert.equal(expired.route(), 'existing route is operational')
  assert.equal(edited.active, 'existing-rollback')
  assert.equal(edited.route(), 'existing route is operational')
  assert.equal(missing.active, 'existing-rollback')
  assert.equal(missing.route(), 'existing route is operational')
  assert.equal(invalid.active, 'existing-rollback')
  assert.equal(invalid.route(), 'existing route is operational')
})

test('transactions and other state-changing requests are sent exactly once', async (context) => {
  const current = await environment(context)
  const rpc = new SolidRpc(current.config)

  await rpc.submitSignedRawTransaction(SAMPLE_RAW_TRANSACTION)
  await rpc.requestStateChange('eth_sendTransaction', [
    { from: ADDRESS, to: ADDRESS, value: '0x0' },
  ])

  assert.deepEqual(
    current.rpc.requests.map(({ method }) => method),
    ['eth_sendRawTransaction', 'eth_sendTransaction'],
  )
  assert.equal(
    current.rpc.requests.filter(({ method }) => method === 'eth_sendRawTransaction').length,
    1,
  )
  assert.equal(
    current.rpc.requests.filter(({ method }) => method === 'eth_sendTransaction').length,
    1,
  )
})

test('an ambiguous transaction failure is never retried', async (context) => {
  const current = await environment(context, {
    rpc: { destroyAfterMethods: ['eth_sendRawTransaction'] },
  })
  const rpc = new SolidRpc(current.config)

  await assert.rejects(
    rpc.submitSignedRawTransaction(SAMPLE_RAW_TRANSACTION),
    /was not retried/i,
  )
  assert.equal(
    current.rpc.requests.filter(({ method }) => method === 'eth_sendRawTransaction').length,
    1,
  )
})

test('WebSocket and provider-specific APIs remain explicit partial-migration boundaries', () => {
  assert.deepEqual(websocketBoundary('PRIMARY_WS_URL'), {
    kind: 'websocket-subscription',
    configurationReference: 'PRIMARY_WS_URL',
    disposition: 'separate-migration-decision',
    automaticHttpFallback: false,
  })
  assert.deepEqual(providerSpecificBoundary('alchemy_getTokenBalances'), {
    kind: 'provider-specific-api',
    method: 'alchemy_getTokenBalances',
    disposition: 'separate-migration-decision',
    automaticHttpFallback: false,
  })
})

test('smoke summaries and request errors are secret-free', async (context) => {
  const current = await environment(context)
  const smoke = await runPrototypeSmoke(current.config)
  const serialized = JSON.stringify(smoke)
  assert.doesNotMatch(serialized, new RegExp(API_KEY))
  assert.match(serialized, /SOLIDRPC_API_KEY/)

  const failing = await environment(context, {
    rpc: { destroyAfterMethods: ['eth_getBalance'] },
  })
  const rpc = new SolidRpc(failing.config)
  await assert.rejects(rpc.getNativeBalance(ADDRESS), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.doesNotMatch(error.message, new RegExp(API_KEY))
    assert.doesNotMatch(error.message, /x-api-key/i)
    return true
  })
})

test('compatible reads and writes use only the single SolidRPC route', async (context) => {
  const current = await environment(context)
  const unusedCurrentProvider = await startMockRpcServer()
  context.after(unusedCurrentProvider.close)
  const rpc = new SolidRpc(current.config)

  const balance = await rpc.getNativeBalance(ADDRESS)
  const transaction = await rpc.submitSignedRawTransaction(
    SAMPLE_RAW_TRANSACTION as Hex,
  )

  assert.equal(balance.provider, 'solidrpc')
  assert.equal(transaction.provider, 'solidrpc')
  assert.deepEqual(
    current.rpc.requests.map(({ method }) => method),
    ['eth_getBalance', 'eth_sendRawTransaction'],
  )
  assert.equal(unusedCurrentProvider.requests.length, 0)
  assert.equal('legacyRpcUrl' in current.config, false)
})

test('a blocked production cutover leaves the current and production state unchanged', () => {
  const decision = qualifyMigration({
    applicationClass: 'production',
    evidenceSources: completeProductionSources(),
    gateFailures: ['Observed peak demand exceeds authenticated plan capacity'],
  })
  const current = { activeProvider: 'current', deploymentRevision: 'unchanged' }
  let changeCalls = 0
  const result = applyQualifiedLocalChange(decision, current, () => {
    changeCalls += 1
    return { activeProvider: 'solidrpc', deploymentRevision: 'changed' }
  })

  assert.equal(decision.status, 'blocked')
  assert.equal(decision.routing.productionStateChanged, false)
  assert.equal(changeCalls, 0)
  assert.strictEqual(result, current)
})

test('an explicit prototype limit beyond the observed plan blocks, not unknown traffic', async (context) => {
  const current = await environment(context, {
    explicitRepositoryLimits: { maximumRequestsPerSecond: 101 },
  })
  const smoke = await runPrototypeSmoke(current.config)
  assert.equal(smoke.status, 'blocked')
  assert.deepEqual(smoke.blockers, [
    'RPC_MAX_REQUESTS_PER_SECOND 101 exceeds the observed rate limit 100',
  ])
})

test('unclear repository signals produce one concise production-classification question', () => {
  assert.equal(
    classifyApplication({
      productionSignals: ['deployment manifest'],
      prototypeSignals: ['example label'],
    }),
    'unknown',
  )
  const decision = qualifyMigration({ applicationClass: 'unknown' })
  assert.deepEqual(decision.questions, [
    'Does this application currently serve production traffic?',
  ])
})
