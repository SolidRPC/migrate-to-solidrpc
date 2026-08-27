import type { CatalogCoverage, RpcDependencies, SolidRpcConfig } from './types'

export class CatalogError extends Error {
  override readonly name = 'CatalogError'
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null
}

export async function requireLiveCatalogCoverage(
  config: SolidRpcConfig,
  requiredMethodFamilies: readonly string[],
  dependencies: RpcDependencies = {},
): Promise<CatalogCoverage> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(config.catalogUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } catch {
    throw new CatalogError('The live SolidRPC network catalog is unavailable')
  }
  if (!response.ok) {
    throw new CatalogError(
      `The live SolidRPC network catalog returned HTTP ${response.status}`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new CatalogError('The live SolidRPC network catalog returned malformed JSON')
  }
  if (!Array.isArray(payload)) {
    throw new CatalogError('The live SolidRPC network catalog must be an array')
  }

  const candidate = payload.find(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).chainId === config.chainId,
  ) as Record<string, unknown> | undefined
  if (!candidate) {
    throw new CatalogError(`Chain ${config.chainId} is not listed in the live catalog`)
  }

  const methodFamilies = strings(candidate.methods)
  const nodeTypes = strings(candidate.nodeTypes)
  if (candidate.status !== 'live' || !methodFamilies || !nodeTypes) {
    throw new CatalogError(`Chain ${config.chainId} is not live with valid coverage metadata`)
  }

  const missing = requiredMethodFamilies.filter(
    (family) => !methodFamilies.includes(family),
  )
  if (missing.length > 0) {
    throw new CatalogError(
      `Chain ${config.chainId} does not support required method families: ${missing.join(', ')}`,
    )
  }

  return {
    chainId: config.chainId,
    ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
    status: 'live',
    methodFamilies: [...methodFamilies],
    nodeTypes: [...nodeTypes],
  }
}
