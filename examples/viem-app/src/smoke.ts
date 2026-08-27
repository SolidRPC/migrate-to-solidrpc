import { authenticationHeaders } from './config'
import { requireLiveCatalogCoverage } from './catalog'
import type {
  PlanLimits,
  PrototypeSmokeResult,
  RpcDependencies,
  SolidRpcConfig,
} from './types'

export class SmokeTestError extends Error {
  override readonly name = 'SmokeTestError'
}

type JsonRpcEnvelope = {
  result?: unknown
  error?: { code?: unknown; message?: unknown }
}

async function readOnlyRequest(
  config: SolidRpcConfig,
  method: 'eth_chainId' | 'eth_blockNumber' | 'eth_getBalance',
  params: readonly unknown[],
  id: number,
  dependencies: RpcDependencies,
): Promise<{ result: unknown; headers: Headers }> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(config.rpcUrl, {
      method: 'POST',
      headers: {
        ...authenticationHeaders(config),
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } catch {
    throw new SmokeTestError(`Authenticated SolidRPC ${method} smoke request failed`)
  }
  if (!response.ok) {
    throw new SmokeTestError(
      `Authenticated SolidRPC ${method} smoke request returned HTTP ${response.status}`,
    )
  }

  let envelope: JsonRpcEnvelope
  try {
    envelope = (await response.json()) as JsonRpcEnvelope
  } catch {
    throw new SmokeTestError(`Authenticated SolidRPC ${method} returned malformed JSON`)
  }
  if (envelope.error || envelope.result === undefined) {
    throw new SmokeTestError(`Authenticated SolidRPC ${method} returned a JSON-RPC error`)
  }
  return { result: envelope.result, headers: response.headers }
}

function requiredLimit(headers: Headers, name: string): number {
  const raw = headers.get(name)
  const value = raw === null ? Number.NaN : Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SmokeTestError(
      `Authenticated SolidRPC response is missing a valid ${name} plan-limit header`,
    )
  }
  return value
}

function planLimits(headers: Headers): PlanLimits {
  const quotaWindow = headers.get('x-quota-window')
  if (quotaWindow !== 'day' && quotaWindow !== 'month') {
    throw new SmokeTestError(
      'Authenticated SolidRPC response is missing a valid X-Quota-Window plan-limit header',
    )
  }
  return {
    ratePerSecond: requiredLimit(headers, 'x-ratelimit-limit'),
    burst: requiredLimit(headers, 'x-ratelimit-burst'),
    remaining: requiredLimit(headers, 'x-ratelimit-remaining'),
    rateResetSeconds: requiredLimit(headers, 'x-ratelimit-reset'),
    quotaLimit: requiredLimit(headers, 'x-quota-limit'),
    quotaWindow,
    quotaUsed: requiredLimit(headers, 'x-quota-used'),
    quotaRemaining: requiredLimit(headers, 'x-quota-remaining'),
    quotaResetSeconds: requiredLimit(headers, 'x-quota-reset'),
  }
}

function repositoryLimitBlockers(
  config: SolidRpcConfig,
  limits: PlanLimits,
): string[] {
  const explicit = config.explicitRepositoryLimits
  const blockers: string[] = []
  if (explicit.largestBatch !== undefined && explicit.largestBatch > limits.burst) {
    blockers.push(
      `RPC_MAX_BATCH_SIZE ${explicit.largestBatch} exceeds the observed burst limit ${limits.burst}`,
    )
  }
  if (
    explicit.maximumRequestsPerSecond !== undefined &&
    explicit.maximumRequestsPerSecond > limits.ratePerSecond
  ) {
    blockers.push(
      `RPC_MAX_REQUESTS_PER_SECOND ${explicit.maximumRequestsPerSecond} exceeds the observed rate limit ${limits.ratePerSecond}`,
    )
  }
  if (
    explicit.maximumConcurrentRequests !== undefined &&
    explicit.maximumConcurrentRequests > limits.burst
  ) {
    blockers.push(
      `RPC_MAX_CONCURRENT_REQUESTS ${explicit.maximumConcurrentRequests} exceeds the observed burst limit ${limits.burst}`,
    )
  }
  if (
    explicit.maximumResponseUnitsPerWindow !== undefined &&
    explicit.maximumResponseUnitsPerWindow > limits.quotaLimit
  ) {
    blockers.push(
      `RPC_MAX_RESPONSE_UNITS_PER_WINDOW ${explicit.maximumResponseUnitsPerWindow} exceeds the observed ${limits.quotaWindow} quota ${limits.quotaLimit}`,
    )
  }
  return blockers
}

function hexadecimalInteger(value: unknown, method: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new SmokeTestError(`Authenticated SolidRPC ${method} returned an invalid result`)
  }
  return BigInt(value)
}

export async function runPrototypeSmoke(
  config: SolidRpcConfig,
  dependencies: RpcDependencies = {},
): Promise<PrototypeSmokeResult> {
  const catalog = await requireLiveCatalogCoverage(config, ['standard'], dependencies)
  const chainResponse = await readOnlyRequest(config, 'eth_chainId', [], 1, dependencies)
  const observedChainId = Number(hexadecimalInteger(chainResponse.result, 'eth_chainId'))
  if (observedChainId !== config.chainId) {
    throw new SmokeTestError(
      `Authenticated SolidRPC returned chain ${observedChainId}; expected ${config.chainId}`,
    )
  }
  const blockResponse = await readOnlyRequest(
    config,
    'eth_blockNumber',
    [],
    2,
    dependencies,
  )
  const observedBlockNumber = hexadecimalInteger(
    blockResponse.result,
    'eth_blockNumber',
  )
  const stableBlockNumber =
    observedBlockNumber > 12n ? observedBlockNumber - 12n : 0n
  const balanceResponse = await readOnlyRequest(
    config,
    'eth_getBalance',
    [config.accountAddress, `0x${stableBlockNumber.toString(16)}`],
    3,
    dependencies,
  )
  const observedBalance = hexadecimalInteger(
    balanceResponse.result,
    'eth_getBalance',
  )
  const limits = planLimits(chainResponse.headers)
  const blockers = repositoryLimitBlockers(config, limits)

  return {
    status: blockers.length === 0 ? 'qualified' : 'blocked',
    applicationClass: 'prototype',
    authenticated: true,
    endpoint: config.rpcUrl,
    apiKeyReference: config.apiKeyReference,
    catalog,
    observedChainId,
    observedBlockNumber: observedBlockNumber.toString(),
    observedBalanceAtStableBlock: observedBalance.toString(),
    planLimits: limits,
    productionCapacityProven: false,
    blockers,
    advisories: [
      'Production capacity has not yet been proven; validate measured production demand before deployment to production.',
    ],
  }
}
