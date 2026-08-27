import { getAddress } from 'viem'
import type { ExplicitRepositoryLimits, SolidRpcConfig } from './types'

export const SOLIDRPC_API_KEY_REFERENCE = 'SOLIDRPC_API_KEY'
export const SOLIDRPC_CATALOG_URL = 'https://api.solidrpc.io/networks'

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError'
}

function positiveInteger(
  environment: NodeJS.ProcessEnv,
  key: string,
  required = false,
): number | undefined {
  const raw = environment[key]?.trim()
  if (!raw && !required) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ConfigurationError(`${key} must be a positive integer`)
  }
  return value
}

function explicitRepositoryLimits(
  environment: NodeJS.ProcessEnv,
): ExplicitRepositoryLimits {
  const limits = {
    largestBatch: positiveInteger(environment, 'RPC_MAX_BATCH_SIZE'),
    maximumRequestsPerSecond: positiveInteger(environment, 'RPC_MAX_REQUESTS_PER_SECOND'),
    maximumConcurrentRequests: positiveInteger(environment, 'RPC_MAX_CONCURRENT_REQUESTS'),
    maximumResponseUnitsPerWindow: positiveInteger(
      environment,
      'RPC_MAX_RESPONSE_UNITS_PER_WINDOW',
    ),
  }
  return Object.fromEntries(
    Object.entries(limits).filter(([, value]) => value !== undefined),
  ) as ExplicitRepositoryLimits
}

export function solidRpcUrl(chainId: number): string {
  return `https://rpc.solidrpc.io/evm/${chainId}`
}

export function loadSolidRpcConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SolidRpcConfig {
  const chainId = positiveInteger(environment, 'CHAIN_ID') ?? 1
  const apiKey = environment[SOLIDRPC_API_KEY_REFERENCE]?.trim()
  if (!apiKey) {
    throw new ConfigurationError(
      `${SOLIDRPC_API_KEY_REFERENCE} must reference an authenticated SolidRPC credential`,
    )
  }

  const account = environment.ACCOUNT_ADDRESS?.trim()
  if (!account) {
    throw new ConfigurationError('ACCOUNT_ADDRESS is required')
  }

  let accountAddress
  try {
    accountAddress = getAddress(account)
  } catch {
    throw new ConfigurationError('ACCOUNT_ADDRESS must be a valid EVM address')
  }

  return {
    chainId,
    rpcUrl: solidRpcUrl(chainId),
    catalogUrl: SOLIDRPC_CATALOG_URL,
    apiKey,
    apiKeyReference: SOLIDRPC_API_KEY_REFERENCE,
    accountAddress,
    requestTimeoutMs: 10_000,
    explicitRepositoryLimits: explicitRepositoryLimits(environment),
  }
}

export function authenticationHeaders(config: SolidRpcConfig): Record<string, string> {
  const endpoint = new URL(config.rpcUrl)
  if (endpoint.username || endpoint.password || endpoint.search) {
    throw new ConfigurationError(
      'SolidRPC credentials must be supplied through X-API-Key, not the endpoint URL',
    )
  }
  return { 'X-API-Key': config.apiKey }
}
