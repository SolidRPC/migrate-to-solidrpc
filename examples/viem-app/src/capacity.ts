import { resolveSolidRpcAuthentication } from './authentication'
import {
  requireCapacityTrafficProfile,
  solidRpcUrl,
} from './config'
import type {
  CapacityTrafficProfile,
  LiveCapacityQualification,
  MigrationConfig,
  MigrationDependencies,
  QuotaWindow,
} from './types'

export class CapacityQualificationError extends Error {
  override readonly name: string = 'CapacityQualificationError'
}

export type SolidRpcLimitClassification =
  | { kind: 'ok'; productionEligible: true }
  | {
      kind: 'recoverable-rate-limit'
      productionEligible: false
      retryAfterSeconds: number
      action: 'wait-before-retrying-read'
    }
  | {
      kind: 'oversized-batch'
      productionEligible: false
      requiredTokens: number
      burst: number
      action: 'reduce-or-split-read-batch'
    }
  | {
      kind: 'quota-exhausted'
      productionEligible: false
      resetSeconds: number | null
      action: 'wait-for-reset-or-upgrade'
    }
  | {
      kind: 'public-limit'
      productionEligible: false
      reason: 'rate_limit' | 'daily_quota'
      retryAfterSeconds: number | null
      action: 'do-not-use-public-traffic-for-production-qualification'
    }
  | {
      kind: 'non-retryable-rate-limit'
      productionEligible: false
      action: 'stop-and-investigate-capacity'
    }
  | {
      kind: 'other-error'
      productionEligible: false
      status: number
      action: 'stop-and-investigate-response'
    }

type HeaderSource = Headers | Record<string, string | undefined>

function headerValue(headers: HeaderSource, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name)
  }
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )
  return match?.[1] ?? null
}

function nonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function bodyRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

export function classifySolidRpcLimitResponse(input: {
  status: number
  headers: HeaderSource
  body: unknown
}): SolidRpcLimitClassification {
  const record = bodyRecord(input.body)
  const error = bodyRecord(record?.error)
  const hasJsonRpcError =
    record !== null &&
    Object.prototype.hasOwnProperty.call(record, 'error') &&
    record.error !== null &&
    record.error !== undefined
  if (input.status >= 200 && input.status < 300) {
    return hasJsonRpcError
      ? {
          kind: 'other-error',
          productionEligible: false,
          status: input.status,
          action: 'stop-and-investigate-response',
        }
      : { kind: 'ok', productionEligible: true }
  }

  const data = bodyRecord(error?.data)
  const reason = data?.reason
  const message = error?.message
  if (
    input.status === 429 &&
    error?.code === -32005 &&
    typeof message === 'string' &&
    message.startsWith('Public RPC') &&
    (reason === 'rate_limit' || reason === 'daily_quota')
  ) {
    return {
      kind: 'public-limit',
      productionEligible: false,
      reason,
      retryAfterSeconds: nonNegativeNumber(
        headerValue(input.headers, 'retry-after'),
      ),
      action: 'do-not-use-public-traffic-for-production-qualification',
    }
  }

  if (input.status === 402) {
    return {
      kind: 'quota-exhausted',
      productionEligible: false,
      resetSeconds: nonNegativeNumber(
        headerValue(input.headers, 'x-quota-reset'),
      ),
      action: 'wait-for-reset-or-upgrade',
    }
  }

  if (input.status === 429) {
    const requiredTokens = nonNegativeNumber(record?.requiredTokens)
    const burst = nonNegativeNumber(
      headerValue(input.headers, 'x-ratelimit-burst'),
    )
    if (
      requiredTokens !== null &&
      burst !== null &&
      requiredTokens > burst
    ) {
      return {
        kind: 'oversized-batch',
        productionEligible: false,
        requiredTokens,
        burst,
        action: 'reduce-or-split-read-batch',
      }
    }

    const retryAfter = nonNegativeNumber(
      headerValue(input.headers, 'retry-after'),
    )
    if (retryAfter !== null && retryAfter > 0) {
      return {
        kind: 'recoverable-rate-limit',
        productionEligible: false,
        retryAfterSeconds: retryAfter,
        action: 'wait-before-retrying-read',
      }
    }

    return {
      kind: 'non-retryable-rate-limit',
      productionEligible: false,
      action: 'stop-and-investigate-capacity',
    }
  }

  return {
    kind: 'other-error',
    productionEligible: false,
    status: input.status,
    action: 'stop-and-investigate-response',
  }
}

function requiredHeaderNumber(
  headers: Headers,
  name: string,
  options: { positive?: boolean; integer?: boolean } = {},
): number {
  const value = headers.get(name)
  const parsed = value === null ? Number.NaN : Number(value)
  const minimumValid = options.positive === true ? parsed > 0 : parsed >= 0
  if (
    !Number.isFinite(parsed) ||
    !minimumValid ||
    (options.integer === true && !Number.isSafeInteger(parsed))
  ) {
    throw new CapacityQualificationError(
      `Authenticated SolidRPC response is missing a valid ${name} header`,
    )
  }
  return parsed
}

function quotaWindow(headers: Headers): QuotaWindow {
  const value = headers.get('x-quota-window')
  if (value !== 'day' && value !== 'month') {
    throw new CapacityQualificationError(
      'Authenticated SolidRPC response is missing a valid X-Quota-Window header',
    )
  }
  return value
}

function assertFiniteProfile(profile: CapacityTrafficProfile): void {
  const nonNegative = [
    profile.sustainedMethodCallsPerSecond,
    profile.peakMethodCallsPerSecond,
    profile.responseUnitsPerQuotaWindow.day,
    profile.responseUnitsPerQuotaWindow.month,
    profile.sharedTraffic.sustainedMethodCallsPerSecond,
    profile.sharedTraffic.peakMethodCallsPerSecond,
    profile.sharedTraffic.responseUnitsPerQuotaWindow.day,
    profile.sharedTraffic.responseUnitsPerQuotaWindow.month,
  ]
  const responseUnits = [
    profile.responseUnitsPerQuotaWindow.day,
    profile.responseUnitsPerQuotaWindow.month,
    profile.sharedTraffic.responseUnitsPerQuotaWindow.day,
    profile.sharedTraffic.responseUnitsPerQuotaWindow.month,
  ]
  if (
    !Number.isSafeInteger(profile.largestValidMethodBatch) ||
    profile.largestValidMethodBatch < 1 ||
    nonNegative.some((value) => !Number.isFinite(value) || value < 0) ||
    !Number.isFinite(profile.retryAmplificationFactor) ||
    profile.retryAmplificationFactor < 1 ||
    !Number.isFinite(profile.headroomPercent) ||
    profile.headroomPercent < 1 ||
    profile.headroomPercent > 90 ||
    responseUnits.some((value) => !Number.isSafeInteger(value))
  ) {
    throw new CapacityQualificationError('Capacity traffic profile is malformed')
  }
  if (
    profile.peakMethodCallsPerSecond <
      profile.sustainedMethodCallsPerSecond ||
    profile.sharedTraffic.peakMethodCallsPerSecond <
      profile.sharedTraffic.sustainedMethodCallsPerSecond
  ) {
    throw new CapacityQualificationError(
      'Peak method-call traffic cannot be lower than sustained traffic',
    )
  }
  if (profile.peakMethodCallsPerSecond < profile.largestValidMethodBatch) {
    throw new CapacityQualificationError(
      'Peak method-call traffic cannot be lower than the largest valid-method batch',
    )
  }
}

function maximumWindowDurationSeconds(window: QuotaWindow): number {
  if (window === 'day') {
    return 24 * 60 * 60
  }
  return 31 * 24 * 60 * 60
}

function jsonRpcChainId(payload: unknown): number {
  const record = bodyRecord(payload)
  if (
    record?.jsonrpc !== '2.0' ||
    record.id !== 'solidrpc-capacity-qualification' ||
    typeof record.result !== 'string'
  ) {
    throw new CapacityQualificationError(
      'Authenticated SolidRPC capacity probe did not return eth_chainId',
    )
  }
  try {
    const value = Number(BigInt(record.result))
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('invalid chain ID')
    }
    return value
  } catch {
    throw new CapacityQualificationError(
      'Authenticated SolidRPC capacity probe returned an invalid chain ID',
    )
  }
}

function failCapacity(message: string): never {
  throw new CapacityQualificationError(message)
}

export async function qualifyLiveCapacity(
  config: MigrationConfig,
  dependencies: MigrationDependencies = {},
): Promise<LiveCapacityQualification> {
  const profile = requireCapacityTrafficProfile(config)
  assertFiniteProfile(profile)
  const authentication = resolveSolidRpcAuthentication(config)
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(solidRpcUrl(config), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...authentication.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'solidrpc-capacity-qualification',
        method: 'eth_chainId',
        params: [],
      }),
      signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new CapacityQualificationError(
      `Authenticated SolidRPC capacity probe is unavailable: ${detail}`,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new CapacityQualificationError(
      'Authenticated SolidRPC capacity probe returned malformed JSON',
    )
  }
  const classification = classifySolidRpcLimitResponse({
    status: response.status,
    headers: response.headers,
    body,
  })
  if (classification.kind !== 'ok') {
    throw new CapacityQualificationError(
      `Authenticated SolidRPC capacity probe failed: ${classification.kind}; ${classification.action}`,
    )
  }
  if (jsonRpcChainId(body) !== config.chainId) {
    throw new CapacityQualificationError(
      'Authenticated SolidRPC capacity probe returned the wrong chain ID',
    )
  }

  const observedAt = (dependencies.now ?? (() => new Date()))()
  const window = quotaWindow(response.headers)
  const limits = {
    ratePerSecond: requiredHeaderNumber(
      response.headers,
      'x-ratelimit-limit',
      { positive: true },
    ),
    burst: requiredHeaderNumber(response.headers, 'x-ratelimit-burst', {
      positive: true,
      integer: true,
    }),
    remaining: requiredHeaderNumber(
      response.headers,
      'x-ratelimit-remaining',
    ),
    resetSeconds: requiredHeaderNumber(
      response.headers,
      'x-ratelimit-reset',
    ),
    quotaLimit: requiredHeaderNumber(response.headers, 'x-quota-limit', {
      positive: true,
      integer: true,
    }),
    quotaWindow: window,
    quotaUsed: requiredHeaderNumber(response.headers, 'x-quota-used', {
      integer: true,
    }),
    quotaRemaining: requiredHeaderNumber(
      response.headers,
      'x-quota-remaining',
      { integer: true },
    ),
    quotaResetSeconds: requiredHeaderNumber(
      response.headers,
      'x-quota-reset',
      { positive: true, integer: true },
    ),
  }
  if (
    limits.remaining > limits.burst ||
    limits.quotaUsed > limits.quotaLimit ||
    limits.quotaRemaining > limits.quotaLimit - limits.quotaUsed
  ) {
    failCapacity('Authenticated SolidRPC limit headers are inconsistent')
  }

  const multiplier = profile.retryAmplificationFactor
  const headroomMultiplier = 1 - profile.headroomPercent / 100
  const sustainedMethodCallsPerSecond =
    (profile.sustainedMethodCallsPerSecond +
      profile.sharedTraffic.sustainedMethodCallsPerSecond) *
    multiplier
  const peakMethodCallsPerSecond =
    (profile.peakMethodCallsPerSecond +
      profile.sharedTraffic.peakMethodCallsPerSecond) *
    multiplier
  const responseUnitsPerQuotaWindow = Math.ceil(
    (profile.responseUnitsPerQuotaWindow[window] +
      profile.sharedTraffic.responseUnitsPerQuotaWindow[window]) *
      multiplier,
  )
  if (
    !Number.isFinite(sustainedMethodCallsPerSecond) ||
    !Number.isFinite(peakMethodCallsPerSecond) ||
    !Number.isSafeInteger(responseUnitsPerQuotaWindow)
  ) {
    failCapacity('Expanded capacity traffic exceeds safe numeric bounds')
  }
  const rateCapacityWithHeadroom = limits.ratePerSecond * headroomMultiplier
  const burstCapacityWithHeadroom = limits.burst * headroomMultiplier
  const quotaCapacityWithHeadroom = Math.floor(
    limits.quotaLimit * headroomMultiplier,
  )
  const totalProbeResponseUnits = 4
  const remainingProbeResponseUnits = 3
  if (
    limits.quotaResetSeconds >
    maximumWindowDurationSeconds(window) + 60
  ) {
    failCapacity('Authenticated SolidRPC quota reset exceeds its reported window')
  }
  const responseUnitsUntilReset =
    responseUnitsPerQuotaWindow + remainingProbeResponseUnits
  if (!Number.isSafeInteger(responseUnitsUntilReset)) {
    failCapacity('Remaining-window capacity exceeds safe numeric bounds')
  }
  if (profile.largestValidMethodBatch > limits.burst) {
    failCapacity(
      `Largest valid-method batch (${profile.largestValidMethodBatch}) exceeds the live burst limit (${limits.burst})`,
    )
  }
  if (profile.largestValidMethodBatch > burstCapacityWithHeadroom) {
    failCapacity('Largest valid-method batch leaves insufficient burst headroom')
  }
  if (sustainedMethodCallsPerSecond > rateCapacityWithHeadroom) {
    failCapacity('Sustained expanded method-call traffic exceeds live rate capacity')
  }
  if (peakMethodCallsPerSecond > rateCapacityWithHeadroom) {
    failCapacity('Peak expanded method-call traffic exceeds live rate capacity')
  }
  if (limits.remaining < 1) {
    failCapacity('Live token bucket has no remaining capacity for comparison')
  }
  if (
    responseUnitsPerQuotaWindow + totalProbeResponseUnits >
      quotaCapacityWithHeadroom
  ) {
    failCapacity(
      'Projected response units exceed the live quota with required headroom',
    )
  }
  if (limits.quotaUsed + responseUnitsUntilReset > quotaCapacityWithHeadroom) {
    failCapacity(
      'Projected response units before reset leave insufficient quota headroom',
    )
  }
  if (responseUnitsUntilReset > limits.quotaRemaining) {
    failCapacity(
      'Projected response units before reset exceed the live remaining quota',
    )
  }

  return {
    status: 'qualified',
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(
      observedAt.getTime() + limits.quotaResetSeconds * 1_000,
    ).toISOString(),
    apiKeyTransport: authentication.transport,
    limits,
    trafficProfile: structuredClone(profile),
    calculated: {
      sustainedMethodCallsPerSecond,
      peakMethodCallsPerSecond,
      responseUnitsPerQuotaWindow,
      responseUnitsUntilReset,
      rateCapacityWithHeadroom,
      burstCapacityWithHeadroom,
      quotaCapacityWithHeadroom,
    },
    probeUsage: {
      rpcRequests: 1,
      methodCalls: 1,
      responseUnits: 1,
    },
  }
}
