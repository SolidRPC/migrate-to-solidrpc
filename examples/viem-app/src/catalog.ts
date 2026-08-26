import { catalogUrl } from './config'
import type {
  CatalogCoverage,
  MigrationConfig,
  MigrationDependencies,
} from './types'

export class CatalogQualificationError extends Error {
  override readonly name: string = 'CatalogQualificationError'
}

type CatalogNetwork = {
  chainId: number
  name?: string
  status: string
  nodeTypes: string[]
  methods: string[]
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseNetwork(value: unknown, chainId: number): CatalogNetwork {
  if (typeof value !== 'object' || value === null) {
    throw new CatalogQualificationError(
      `SolidRPC catalog entry for chain ${chainId} is malformed`,
    )
  }

  const record = value as Record<string, unknown>
  if (
    record.chainId !== chainId ||
    typeof record.status !== 'string' ||
    !stringArray(record.nodeTypes) ||
    !stringArray(record.methods) ||
    (record.name !== undefined && typeof record.name !== 'string')
  ) {
    throw new CatalogQualificationError(
      `SolidRPC catalog entry for chain ${chainId} is malformed`,
    )
  }

  return {
    chainId,
    ...(record.name === undefined ? {} : { name: record.name }),
    status: record.status,
    nodeTypes: [...record.nodeTypes],
    methods: [...record.methods],
  }
}

export async function qualifyCatalogCoverage(
  config: MigrationConfig,
  dependencies: MigrationDependencies = {},
): Promise<CatalogCoverage> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const url = catalogUrl(config)
  let response: Response

  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new CatalogQualificationError(
      `SolidRPC catalog is unavailable: ${detail}`,
    )
  }

  if (!response.ok) {
    throw new CatalogQualificationError(
      `SolidRPC catalog is unavailable: HTTP ${response.status}`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new CatalogQualificationError('SolidRPC catalog response is malformed JSON')
  }

  if (!Array.isArray(payload)) {
    throw new CatalogQualificationError('SolidRPC catalog response must be a JSON array')
  }

  const entry = payload.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Record<string, unknown>).chainId === config.chainId,
  )
  if (entry === undefined) {
    throw new CatalogQualificationError(
      `SolidRPC catalog does not list chain ${config.chainId}`,
    )
  }

  const network = parseNetwork(entry, config.chainId)
  if (network.status !== 'live') {
    throw new CatalogQualificationError(
      `SolidRPC chain ${config.chainId} is not live (status: ${network.status})`,
    )
  }
  if (!network.methods.includes('standard')) {
    throw new CatalogQualificationError(
      `SolidRPC chain ${config.chainId} does not advertise the standard method family`,
    )
  }

  return {
    fetchedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    chainId: network.chainId,
    ...(network.name === undefined ? {} : { name: network.name }),
    status: 'live',
    nodeTypes: network.nodeTypes,
    methods: network.methods,
  }
}
