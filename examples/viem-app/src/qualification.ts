import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAddress, isHash, type Address } from 'viem'
import {
  CUSTOMER_JWT_SAFETY_SKEW_SECONDS,
  resolveSolidRpcAuthentication,
} from './authentication'
import {
  catalogUrl,
  qualificationFile,
  qualificationTtlMs,
  requireSolidRpcApiKey,
  solidRpcUrl,
} from './config'
import type {
  CatalogCoverage,
  ComparableBalanceResult,
  LiveCapacityQualification,
  MigrationConfig,
  MigrationDependencies,
  QualificationEvidence,
  QualificationEvidencePayload,
  SolidRpcProbeUsage,
} from './types'

export class QualificationEvidenceError extends Error {
  override readonly name: string = 'QualificationEvidenceError'
}

export const ROUTING_INVARIANT_CHECK_ID =
  'viem-sample-partial-read-routing-invariants-v3' as const

const QUALIFICATION_PROBE_USAGE: SolidRpcProbeUsage = {
  rpcRequests: 4,
  methodCalls: 4,
  responseUnits: 4,
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new QualificationEvidenceError(
        'Qualification evidence contains a non-finite number',
      )
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    return `{${Object.keys(candidate)
      .filter((key) => candidate[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(candidate[key])}`,
      )
      .join(',')}}`
  }
  throw new QualificationEvidenceError(
    'Qualification evidence contains an unsupported value',
  )
}

function evidenceDigest(
  payload: QualificationEvidencePayload,
  apiKey: string,
): string {
  return createHmac('sha256', apiKey)
    .update(canonicalJson(payload))
    .digest('hex')
}

function configurationFingerprint(
  config: MigrationConfig,
  address: Address,
): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 2,
      mode: 'partial-read-replace',
      chainId: config.chainId,
      legacyRpcUrlHash: sha256(config.legacyRpcUrl),
      solidRpcUrl: solidRpcUrl(config),
      catalogUrl: catalogUrl(config),
      qualificationTtlMs: qualificationTtlMs(config),
      comparisonMethod: 'eth_getBalance',
      comparisonAddress: address.toLowerCase(),
      requiredMethodFamilies: ['standard'],
      requiredNodeTypes: [],
      solidRpcApiKeyHash: sha256(requireSolidRpcApiKey(config)),
      solidRpcApiKeyTransport: config.solidRpcApiKeyTransport ?? 'x-api-key',
      customerAuthorizationRequired:
        config.solidRpcCustomerAuthorizationRequired === true,
      customerAuthorizationConfigured: Boolean(
        config.solidRpcCustomerAuthorization?.trim(),
      ),
      customerAuthorizationHash: config.solidRpcCustomerAuthorization?.trim()
        ? sha256(config.solidRpcCustomerAuthorization.trim())
        : null,
      capacityTrafficProfile: config.capacityTrafficProfile,
      requiredProjectChecks: {
        routingInvariant: {
          id: ROUTING_INVARIANT_CHECK_ID,
          required: true,
          solidRpcOnlyMethods: ['eth_getBalance'],
          retainedLegacyMethods: ['eth_sendRawTransaction'],
        },
      },
    }),
  )
}

export function createQualificationEvidence(
  config: MigrationConfig,
  address: Address,
  catalog: CatalogCoverage,
  capacity: LiveCapacityQualification,
  comparison: ComparableBalanceResult,
  dependencies: MigrationDependencies = {},
): QualificationEvidence {
  const qualifiedAt = (dependencies.now ?? (() => new Date()))()
  const ttlExpiry = qualifiedAt.getTime() + qualificationTtlMs(config)
  const capacityExpiry = Date.parse(capacity.expiresAt)
  if (!Number.isFinite(capacityExpiry) || capacityExpiry <= qualifiedAt.getTime()) {
    throw new QualificationEvidenceError(
      'Live capacity evidence expires before replacement can be qualified',
    )
  }
  const authentication = resolveSolidRpcAuthentication(config)
  const customerJwtExpiry =
    authentication.customerJwtExpiresAtEpochSeconds === undefined
      ? null
      : authentication.customerJwtExpiresAtEpochSeconds * 1_000
  const customerJwtBound =
    customerJwtExpiry === null
      ? Number.POSITIVE_INFINITY
      : customerJwtExpiry - CUSTOMER_JWT_SAFETY_SKEW_SECONDS * 1_000
  if (customerJwtBound <= qualifiedAt.getTime()) {
    throw new QualificationEvidenceError(
      'Customer JWT expires too soon for replacement qualification',
    )
  }
  const expiresAt = new Date(
    Math.min(ttlExpiry, capacityExpiry, customerJwtBound),
  )

  const payload: QualificationEvidencePayload = {
    schemaVersion: 2,
    kind: 'solidrpc-read-qualification',
    mode: 'partial-read-replace',
    configurationFingerprint: configurationFingerprint(config, address),
    chainId: config.chainId,
    solidRpcUrl: solidRpcUrl(config),
    catalogUrl: catalogUrl(config),
    requiredMethodFamilies: ['standard'],
    requiredNodeTypes: [],
    requiredProjectChecks: {
      routingInvariant: {
        id: ROUTING_INVARIANT_CHECK_ID,
        required: true,
        solidRpcOnlyMethods: ['eth_getBalance'],
        retainedLegacyMethods: ['eth_sendRawTransaction'],
      },
    },
    credentialBinding: {
      customerJwtExpiresAt:
        customerJwtExpiry === null
          ? null
          : new Date(customerJwtExpiry).toISOString(),
      safetySkewSeconds: CUSTOMER_JWT_SAFETY_SKEW_SECONDS,
    },
    qualifiedAt: qualifiedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    catalog,
    capacity,
    probeUsage: QUALIFICATION_PROBE_USAGE,
    comparison: {
      method: 'eth_getBalance',
      address,
      blockNumber: comparison.blockNumber.toString(),
      blockHash: comparison.blockHash,
      legacyResult: comparison.legacyResult.toString(),
      solidRpcResult: comparison.solidRpcResult.toString(),
    },
  }
  return {
    ...payload,
    integrity: {
      algorithm: 'hmac-sha256',
      digest: evidenceDigest(payload, requireSolidRpcApiKey(config)),
    },
  }
}

export async function writeQualificationEvidence(
  config: MigrationConfig,
  evidence: QualificationEvidence,
): Promise<string> {
  const path = qualificationFile(config)
  const directory = dirname(path)
  const temporaryPath = `${path}.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
  return path
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finiteNumber(value: unknown, minimum = 0): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
}

function integer(value: unknown, minimum = 0): boolean {
  return Number.isSafeInteger(value) && (value as number) >= minimum
}

function validProbeUsage(value: unknown): value is SolidRpcProbeUsage {
  const candidate = record(value)
  return (
    candidate !== null &&
    integer(candidate.rpcRequests) &&
    integer(candidate.methodCalls) &&
    integer(candidate.responseUnits)
  )
}

function validTrafficProfile(value: unknown): boolean {
  const profile = record(value)
  const responseUnits = record(profile?.responseUnitsPerQuotaWindow)
  const shared = record(profile?.sharedTraffic)
  const sharedUnits = record(shared?.responseUnitsPerQuotaWindow)
  return (
    profile !== null &&
    integer(profile.largestValidMethodBatch, 1) &&
    finiteNumber(profile.sustainedMethodCallsPerSecond) &&
    finiteNumber(profile.peakMethodCallsPerSecond) &&
    responseUnits !== null &&
    integer(responseUnits.day) &&
    integer(responseUnits.month) &&
    shared !== null &&
    finiteNumber(shared.sustainedMethodCallsPerSecond) &&
    finiteNumber(shared.peakMethodCallsPerSecond) &&
    sharedUnits !== null &&
    integer(sharedUnits.day) &&
    integer(sharedUnits.month) &&
    finiteNumber(profile.retryAmplificationFactor, 1) &&
    finiteNumber(profile.headroomPercent, 1) &&
    Number(profile.headroomPercent) <= 90
  )
}

function validCapacity(value: unknown): value is LiveCapacityQualification {
  const capacity = record(value)
  const limits = record(capacity?.limits)
  const calculated = record(capacity?.calculated)
  return (
    capacity !== null &&
    capacity.status === 'qualified' &&
    typeof capacity.observedAt === 'string' &&
    typeof capacity.expiresAt === 'string' &&
    (capacity.apiKeyTransport === 'x-api-key' ||
      capacity.apiKeyTransport === 'bearer') &&
    limits !== null &&
    finiteNumber(limits.ratePerSecond, 1) &&
    integer(limits.burst, 1) &&
    finiteNumber(limits.remaining) &&
    finiteNumber(limits.resetSeconds) &&
    integer(limits.quotaLimit, 1) &&
    (limits.quotaWindow === 'day' || limits.quotaWindow === 'month') &&
    integer(limits.quotaUsed) &&
    integer(limits.quotaRemaining) &&
    integer(limits.quotaResetSeconds, 1) &&
    validTrafficProfile(capacity.trafficProfile) &&
    calculated !== null &&
    finiteNumber(calculated.sustainedMethodCallsPerSecond) &&
    finiteNumber(calculated.peakMethodCallsPerSecond) &&
    integer(calculated.responseUnitsPerQuotaWindow) &&
    integer(calculated.responseUnitsUntilReset) &&
    finiteNumber(calculated.rateCapacityWithHeadroom) &&
    finiteNumber(calculated.burstCapacityWithHeadroom) &&
    integer(calculated.quotaCapacityWithHeadroom) &&
    validProbeUsage(capacity.probeUsage)
  )
}

function parseEvidence(value: unknown): QualificationEvidence {
  const candidate = record(value)
  const catalog = record(candidate?.catalog)
  const comparison = record(candidate?.comparison)
  const requiredProjectChecks = record(candidate?.requiredProjectChecks)
  const routingInvariant = record(requiredProjectChecks?.routingInvariant)
  const credentialBinding = record(candidate?.credentialBinding)
  const integrity = record(candidate?.integrity)
  if (
    candidate === null ||
    candidate.schemaVersion !== 2 ||
    candidate.kind !== 'solidrpc-read-qualification' ||
    candidate.mode !== 'partial-read-replace' ||
    typeof candidate.configurationFingerprint !== 'string' ||
    typeof candidate.chainId !== 'number' ||
    typeof candidate.solidRpcUrl !== 'string' ||
    typeof candidate.catalogUrl !== 'string' ||
    !isStringArray(candidate.requiredMethodFamilies) ||
    !isStringArray(candidate.requiredNodeTypes) ||
    routingInvariant === null ||
    routingInvariant.id !== ROUTING_INVARIANT_CHECK_ID ||
    routingInvariant.required !== true ||
    !Array.isArray(routingInvariant.solidRpcOnlyMethods) ||
    routingInvariant.solidRpcOnlyMethods.length !== 1 ||
    routingInvariant.solidRpcOnlyMethods[0] !== 'eth_getBalance' ||
    !Array.isArray(routingInvariant.retainedLegacyMethods) ||
    routingInvariant.retainedLegacyMethods.length !== 1 ||
    routingInvariant.retainedLegacyMethods[0] !== 'eth_sendRawTransaction' ||
    credentialBinding === null ||
    (credentialBinding.customerJwtExpiresAt !== null &&
      typeof credentialBinding.customerJwtExpiresAt !== 'string') ||
    credentialBinding.safetySkewSeconds !==
      CUSTOMER_JWT_SAFETY_SKEW_SECONDS ||
    integrity === null ||
    integrity.algorithm !== 'hmac-sha256' ||
    typeof integrity.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(integrity.digest) ||
    typeof candidate.qualifiedAt !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    catalog === null ||
    typeof catalog.fetchedAt !== 'string' ||
    typeof catalog.chainId !== 'number' ||
    typeof catalog.status !== 'string' ||
    !isStringArray(catalog.nodeTypes) ||
    !isStringArray(catalog.methods) ||
    (catalog.name !== undefined && typeof catalog.name !== 'string') ||
    !validCapacity(candidate.capacity) ||
    !validProbeUsage(candidate.probeUsage) ||
    comparison === null ||
    comparison.method !== 'eth_getBalance' ||
    typeof comparison.address !== 'string' ||
    typeof comparison.blockNumber !== 'string' ||
    typeof comparison.blockHash !== 'string' ||
    typeof comparison.legacyResult !== 'string' ||
    typeof comparison.solidRpcResult !== 'string'
  ) {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }
  if (
    credentialBinding.customerJwtExpiresAt !== null &&
    !Number.isFinite(Date.parse(credentialBinding.customerJwtExpiresAt as string))
  ) {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }

  try {
    getAddress(comparison.address)
    BigInt(comparison.blockNumber)
    BigInt(comparison.legacyResult)
    BigInt(comparison.solidRpcResult)
  } catch {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }
  if (!isHash(comparison.blockHash)) {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }

  return value as QualificationEvidence
}

export async function readValidQualificationEvidence(
  config: MigrationConfig,
  address: Address,
  dependencies: MigrationDependencies = {},
): Promise<QualificationEvidence> {
  const path = qualificationFile(config)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new QualificationEvidenceError(
        `Qualification evidence is missing at ${path}; run npm run rpc:qualify`,
      )
    }
    throw new QualificationEvidenceError(
      `Cannot read qualification evidence at ${path}`,
    )
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }
  const evidence = parseEvidence(decoded)
  const { integrity, ...payload } = evidence
  const expectedDigest = evidenceDigest(
    payload,
    requireSolidRpcApiKey(config),
  )
  const suppliedDigest = Buffer.from(integrity.digest, 'hex')
  const expectedDigestBytes = Buffer.from(expectedDigest, 'hex')
  if (
    suppliedDigest.length !== expectedDigestBytes.length ||
    !timingSafeEqual(suppliedDigest, expectedDigestBytes)
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence integrity does not match the current credential',
    )
  }
  const authentication = resolveSolidRpcAuthentication(config)
  const expectedCustomerJwtExpiry =
    authentication.customerJwtExpiresAtEpochSeconds === undefined
      ? null
      : new Date(
          authentication.customerJwtExpiresAtEpochSeconds * 1_000,
        ).toISOString()
  if (
    evidence.credentialBinding.customerJwtExpiresAt !==
      expectedCustomerJwtExpiry ||
    evidence.credentialBinding.safetySkewSeconds !==
      CUSTOMER_JWT_SAFETY_SKEW_SECONDS
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence does not match the current credential',
    )
  }
  const qualifiedAt = Date.parse(evidence.qualifiedAt)
  const expiresAt = Date.parse(evidence.expiresAt)
  const catalogFetchedAt = Date.parse(evidence.catalog.fetchedAt)
  const capacityObservedAt = Date.parse(evidence.capacity.observedAt)
  const capacityExpiresAt = Date.parse(evidence.capacity.expiresAt)
  const customerJwtBound =
    expectedCustomerJwtExpiry === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(expectedCustomerJwtExpiry) -
        CUSTOMER_JWT_SAFETY_SKEW_SECONDS * 1_000
  const now = (dependencies.now ?? (() => new Date()))().getTime()
  const ttl = qualificationTtlMs(config)

  if (
    !Number.isFinite(qualifiedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(catalogFetchedAt) ||
    !Number.isFinite(capacityObservedAt) ||
    !Number.isFinite(capacityExpiresAt) ||
    qualifiedAt > now ||
    catalogFetchedAt > qualifiedAt ||
    capacityObservedAt > qualifiedAt ||
    expiresAt <= qualifiedAt ||
    expiresAt - qualifiedAt > ttl ||
    expiresAt > capacityExpiresAt ||
    expiresAt > customerJwtBound ||
    now >= expiresAt
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence is expired or has invalid timestamps',
    )
  }

  if (
    evidence.configurationFingerprint !==
      configurationFingerprint(config, address) ||
    evidence.mode !== 'partial-read-replace' ||
    evidence.chainId !== config.chainId ||
    evidence.solidRpcUrl !== solidRpcUrl(config) ||
    evidence.catalogUrl !== catalogUrl(config) ||
    evidence.requiredMethodFamilies.length !== 1 ||
    evidence.requiredMethodFamilies[0] !== 'standard' ||
    evidence.requiredNodeTypes.length !== 0 ||
    evidence.requiredProjectChecks.routingInvariant.id !==
      ROUTING_INVARIANT_CHECK_ID ||
    evidence.requiredProjectChecks.routingInvariant.required !== true ||
    evidence.requiredProjectChecks.routingInvariant.solidRpcOnlyMethods.length !==
      1 ||
    evidence.requiredProjectChecks.routingInvariant.solidRpcOnlyMethods[0] !==
      'eth_getBalance' ||
    evidence.requiredProjectChecks.routingInvariant.retainedLegacyMethods
      .length !== 1 ||
    evidence.requiredProjectChecks.routingInvariant.retainedLegacyMethods[0] !==
      'eth_sendRawTransaction' ||
    evidence.catalog.chainId !== config.chainId ||
    evidence.catalog.status !== 'live' ||
    !evidence.catalog.methods.includes('standard') ||
    evidence.capacity.apiKeyTransport !==
      (config.solidRpcApiKeyTransport ?? 'x-api-key') ||
    evidence.capacity.probeUsage.rpcRequests !== 1 ||
    evidence.capacity.probeUsage.methodCalls !== 1 ||
    evidence.capacity.probeUsage.responseUnits !== 1 ||
    evidence.probeUsage.rpcRequests !== QUALIFICATION_PROBE_USAGE.rpcRequests ||
    evidence.probeUsage.methodCalls !== QUALIFICATION_PROBE_USAGE.methodCalls ||
    evidence.probeUsage.responseUnits !==
      QUALIFICATION_PROBE_USAGE.responseUnits ||
    evidence.comparison.address.toLowerCase() !== address.toLowerCase() ||
    evidence.comparison.legacyResult !== evidence.comparison.solidRpcResult
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence does not match the current configuration',
    )
  }

  return evidence
}
