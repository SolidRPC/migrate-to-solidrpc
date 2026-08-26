import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getAddress, isHash, type Address } from 'viem'
import {
  catalogUrl,
  qualificationFile,
  qualificationTtlMs,
  solidRpcUrl,
} from './config'
import type {
  CatalogCoverage,
  ComparableBalanceResult,
  MigrationConfig,
  MigrationDependencies,
  QualificationEvidence,
} from './types'

export class QualificationEvidenceError extends Error {
  override readonly name: string = 'QualificationEvidenceError'
}

export const ROUTING_INVARIANT_CHECK_ID =
  'viem-sample-routing-invariants-v1' as const

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function configurationFingerprint(
  config: MigrationConfig,
  address: Address,
): string {
  return sha256(
    JSON.stringify({
      schemaVersion: 1,
      mode: 'replace',
      chainId: config.chainId,
      legacyRpcUrlHash: sha256(config.legacyRpcUrl),
      solidRpcUrl: solidRpcUrl(config),
      catalogUrl: catalogUrl(config),
      qualificationTtlMs: qualificationTtlMs(config),
      comparisonMethod: 'eth_getBalance',
      comparisonAddress: address.toLowerCase(),
      requiredMethodFamilies: ['standard'],
      requiredNodeTypes: [],
      requiredProjectChecks: {
        routingInvariant: {
          id: ROUTING_INVARIANT_CHECK_ID,
          required: true,
        },
      },
    }),
  )
}

export function createQualificationEvidence(
  config: MigrationConfig,
  address: Address,
  catalog: CatalogCoverage,
  comparison: ComparableBalanceResult,
  dependencies: MigrationDependencies = {},
): QualificationEvidence {
  const qualifiedAt = (dependencies.now ?? (() => new Date()))()
  const expiresAt = new Date(qualifiedAt.getTime() + qualificationTtlMs(config))

  return {
    schemaVersion: 1,
    kind: 'solidrpc-read-qualification',
    mode: 'replace',
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
      },
    },
    qualifiedAt: qualifiedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    catalog,
    comparison: {
      method: 'eth_getBalance',
      address,
      blockNumber: comparison.blockNumber.toString(),
      blockHash: comparison.blockHash,
      legacyResult: comparison.legacyResult.toString(),
      solidRpcResult: comparison.solidRpcResult.toString(),
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

function parseEvidence(value: unknown): QualificationEvidence {
  if (typeof value !== 'object' || value === null) {
    throw new QualificationEvidenceError('Qualification evidence is malformed')
  }
  const record = value as Record<string, unknown>
  const catalog = record.catalog as Record<string, unknown> | undefined
  const comparison = record.comparison as Record<string, unknown> | undefined
  const requiredProjectChecks = record.requiredProjectChecks as
    | Record<string, unknown>
    | undefined
  const routingInvariant = requiredProjectChecks?.routingInvariant as
    | Record<string, unknown>
    | undefined
  if (
    record.schemaVersion !== 1 ||
    record.kind !== 'solidrpc-read-qualification' ||
    record.mode !== 'replace' ||
    typeof record.configurationFingerprint !== 'string' ||
    typeof record.chainId !== 'number' ||
    typeof record.solidRpcUrl !== 'string' ||
    typeof record.catalogUrl !== 'string' ||
    !isStringArray(record.requiredMethodFamilies) ||
    !isStringArray(record.requiredNodeTypes) ||
    typeof requiredProjectChecks !== 'object' ||
    requiredProjectChecks === null ||
    typeof routingInvariant !== 'object' ||
    routingInvariant === null ||
    routingInvariant.id !== ROUTING_INVARIANT_CHECK_ID ||
    routingInvariant.required !== true ||
    typeof record.qualifiedAt !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    typeof catalog !== 'object' ||
    catalog === null ||
    typeof catalog.fetchedAt !== 'string' ||
    typeof catalog.chainId !== 'number' ||
    typeof catalog.status !== 'string' ||
    !isStringArray(catalog.nodeTypes) ||
    !isStringArray(catalog.methods) ||
    (catalog.name !== undefined && typeof catalog.name !== 'string') ||
    typeof comparison !== 'object' ||
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
  const qualifiedAt = Date.parse(evidence.qualifiedAt)
  const expiresAt = Date.parse(evidence.expiresAt)
  const catalogFetchedAt = Date.parse(evidence.catalog.fetchedAt)
  const now = (dependencies.now ?? (() => new Date()))().getTime()
  const ttl = qualificationTtlMs(config)

  if (
    !Number.isFinite(qualifiedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(catalogFetchedAt) ||
    qualifiedAt > now ||
    catalogFetchedAt > qualifiedAt ||
    expiresAt <= qualifiedAt ||
    expiresAt - qualifiedAt > ttl ||
    now >= expiresAt
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence is expired or has invalid timestamps',
    )
  }

  if (
    evidence.configurationFingerprint !==
      configurationFingerprint(config, address) ||
    evidence.mode !== 'replace' ||
    evidence.chainId !== config.chainId ||
    evidence.solidRpcUrl !== solidRpcUrl(config) ||
    evidence.catalogUrl !== catalogUrl(config) ||
    evidence.requiredMethodFamilies.length !== 1 ||
    evidence.requiredMethodFamilies[0] !== 'standard' ||
    evidence.requiredNodeTypes.length !== 0 ||
    evidence.requiredProjectChecks.routingInvariant.id !==
      ROUTING_INVARIANT_CHECK_ID ||
    evidence.requiredProjectChecks.routingInvariant.required !== true ||
    evidence.catalog.chainId !== config.chainId ||
    evidence.catalog.status !== 'live' ||
    !evidence.catalog.methods.includes('standard') ||
    evidence.comparison.address.toLowerCase() !== address.toLowerCase() ||
    evidence.comparison.legacyResult !== evidence.comparison.solidRpcResult
  ) {
    throw new QualificationEvidenceError(
      'Qualification evidence does not match the current configuration',
    )
  }

  return evidence
}
