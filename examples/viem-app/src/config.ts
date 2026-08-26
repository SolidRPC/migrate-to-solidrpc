import type { Address } from 'viem'
import { getAddress } from 'viem'
import type { MigrationConfig, RpcProvider } from './types'

const DEFAULT_CHAIN_ID = 1

export class ConfigurationError extends Error {
  override readonly name: string = 'ConfigurationError'
}

export class MissingSolidRpcCredentialError extends ConfigurationError {
  override readonly name: string = 'MissingSolidRpcCredentialError'

  constructor() {
    super('SOLIDRPC_API_KEY is required for SolidRPC comparison or primary traffic')
  }
}

function parseChainId(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_CHAIN_ID
  }

  const chainId = Number(value)
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new ConfigurationError('CHAIN_ID must be a positive integer')
  }

  return chainId
}

function parsePrimaryProvider(value: string | undefined): RpcProvider {
  if (value === undefined || value.trim() === '' || value === 'legacy') {
    return 'legacy'
  }

  if (value === 'solidrpc') {
    return 'solidrpc'
  }

  throw new ConfigurationError('RPC_PRIMARY must be either legacy or solidrpc')
}

function requireLegacyUrl(value: string | undefined): string {
  const url = value?.trim()
  if (!url) {
    throw new ConfigurationError('LEGACY_RPC_URL is required')
  }

  return url
}

export function loadMigrationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MigrationConfig {
  const chainId = parseChainId(environment.CHAIN_ID)
  const apiKey = environment.SOLIDRPC_API_KEY?.trim()

  return {
    chainId,
    primaryProvider: parsePrimaryProvider(environment.RPC_PRIMARY),
    legacyRpcUrl: requireLegacyUrl(environment.LEGACY_RPC_URL),
    solidRpcApiKey: apiKey || undefined,
    solidRpcUrl: `https://rpc.solidrpc.io/evm/${chainId}`,
  }
}

export function loadAccountAddress(
  environment: NodeJS.ProcessEnv = process.env,
): Address {
  const value = environment.ACCOUNT_ADDRESS?.trim()
  if (!value) {
    throw new ConfigurationError('ACCOUNT_ADDRESS is required')
  }

  try {
    return getAddress(value)
  } catch {
    throw new ConfigurationError('ACCOUNT_ADDRESS must be a valid EVM address')
  }
}

export function requireSolidRpcApiKey(config: MigrationConfig): string {
  const apiKey = config.solidRpcApiKey?.trim()
  if (!apiKey) {
    throw new MissingSolidRpcCredentialError()
  }

  return apiKey
}
