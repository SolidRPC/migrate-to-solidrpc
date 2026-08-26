import type { Address } from 'viem'
import { getAddress } from 'viem'
import type { MigrationConfig } from './types'

export const DEFAULT_CATALOG_URL = 'https://api.solidrpc.io/networks'
export const DEFAULT_QUALIFICATION_FILE = '.solidrpc/qualification.json'
export const DEFAULT_QUALIFICATION_TTL_MS = 24 * 60 * 60 * 1_000

const DEFAULT_CHAIN_ID = 1

export class ConfigurationError extends Error {
  override readonly name: string = 'ConfigurationError'
}

export class MissingSolidRpcCredentialError extends ConfigurationError {
  override readonly name: string = 'MissingSolidRpcCredentialError'

  constructor() {
    super('SOLIDRPC_API_KEY is required for SolidRPC qualification or replacement')
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
    legacyRpcUrl: requireLegacyUrl(environment.LEGACY_RPC_URL),
    solidRpcApiKey: apiKey || undefined,
    solidRpcUrl: `https://rpc.solidrpc.io/evm/${chainId}`,
    catalogUrl: DEFAULT_CATALOG_URL,
    qualificationFile: DEFAULT_QUALIFICATION_FILE,
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

export function solidRpcUrl(config: MigrationConfig): string {
  return config.solidRpcUrl ?? `https://rpc.solidrpc.io/evm/${config.chainId}`
}

export function catalogUrl(config: MigrationConfig): string {
  return config.catalogUrl ?? DEFAULT_CATALOG_URL
}

export function qualificationFile(config: MigrationConfig): string {
  return config.qualificationFile ?? DEFAULT_QUALIFICATION_FILE
}

export function qualificationTtlMs(config: MigrationConfig): number {
  const value = config.qualificationTtlMs ?? DEFAULT_QUALIFICATION_TTL_MS
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > DEFAULT_QUALIFICATION_TTL_MS
  ) {
    throw new ConfigurationError(
      `qualificationTtlMs must be between 1 and ${DEFAULT_QUALIFICATION_TTL_MS}`,
    )
  }
  return value
}
