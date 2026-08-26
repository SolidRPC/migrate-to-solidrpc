import type { Address } from 'viem'
import { getAddress } from 'viem'
import type {
  CapacityTrafficProfile,
  MigrationConfig,
  SolidRpcApiKeyTransport,
} from './types'

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

export class MissingCapacityProfileError extends ConfigurationError {
  override readonly name: string = 'MissingCapacityProfileError'

  constructor() {
    super(
      'A measured capacity traffic profile is required for SolidRPC replacement qualification',
    )
  }
}

const CAPACITY_ENVIRONMENT_KEYS = [
  'RPC_LARGEST_VALID_METHOD_BATCH',
  'RPC_SUSTAINED_METHOD_CALLS_PER_SECOND',
  'RPC_PEAK_METHOD_CALLS_PER_SECOND',
  'RPC_RESPONSE_UNITS_PER_DAY',
  'RPC_RESPONSE_UNITS_PER_MONTH',
  'RPC_SHARED_SUSTAINED_METHOD_CALLS_PER_SECOND',
  'RPC_SHARED_PEAK_METHOD_CALLS_PER_SECOND',
  'RPC_SHARED_RESPONSE_UNITS_PER_DAY',
  'RPC_SHARED_RESPONSE_UNITS_PER_MONTH',
  'RPC_RETRY_AMPLIFICATION_FACTOR',
  'RPC_CAPACITY_HEADROOM_PERCENT',
] as const

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function parseNumber(
  name: string,
  value: string,
  options: { integer?: boolean; minimum: number; maximum?: number },
): number {
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    (options.integer === true && !Number.isSafeInteger(parsed)) ||
    parsed < options.minimum ||
    (options.maximum !== undefined && parsed > options.maximum)
  ) {
    const kind = options.integer === true ? 'integer' : 'number'
    throw new ConfigurationError(`${name} must be a valid ${kind}`)
  }
  return parsed
}

function parseBoolean(name: string, value: string): boolean {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new ConfigurationError(`${name} must be true or false`)
}

function loadCapacityTrafficProfile(
  environment: NodeJS.ProcessEnv,
): CapacityTrafficProfile | undefined {
  const values = Object.fromEntries(
    CAPACITY_ENVIRONMENT_KEYS.map((key) => [key, optionalValue(environment[key])]),
  ) as Record<(typeof CAPACITY_ENVIRONMENT_KEYS)[number], string | undefined>
  const configured = CAPACITY_ENVIRONMENT_KEYS.filter(
    (key) => values[key] !== undefined,
  )
  if (configured.length === 0) {
    return undefined
  }
  const missing = CAPACITY_ENVIRONMENT_KEYS.filter(
    (key) => values[key] === undefined,
  )
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Capacity profile is incomplete; missing ${missing.join(', ')}`,
    )
  }

  const get = (key: (typeof CAPACITY_ENVIRONMENT_KEYS)[number]): string =>
    values[key] as string
  return {
    largestValidMethodBatch: parseNumber(
      'RPC_LARGEST_VALID_METHOD_BATCH',
      get('RPC_LARGEST_VALID_METHOD_BATCH'),
      { integer: true, minimum: 1 },
    ),
    sustainedMethodCallsPerSecond: parseNumber(
      'RPC_SUSTAINED_METHOD_CALLS_PER_SECOND',
      get('RPC_SUSTAINED_METHOD_CALLS_PER_SECOND'),
      { minimum: 0 },
    ),
    peakMethodCallsPerSecond: parseNumber(
      'RPC_PEAK_METHOD_CALLS_PER_SECOND',
      get('RPC_PEAK_METHOD_CALLS_PER_SECOND'),
      { minimum: 0 },
    ),
    responseUnitsPerQuotaWindow: {
      day: parseNumber(
        'RPC_RESPONSE_UNITS_PER_DAY',
        get('RPC_RESPONSE_UNITS_PER_DAY'),
        { integer: true, minimum: 0 },
      ),
      month: parseNumber(
        'RPC_RESPONSE_UNITS_PER_MONTH',
        get('RPC_RESPONSE_UNITS_PER_MONTH'),
        { integer: true, minimum: 0 },
      ),
    },
    sharedTraffic: {
      sustainedMethodCallsPerSecond: parseNumber(
        'RPC_SHARED_SUSTAINED_METHOD_CALLS_PER_SECOND',
        get('RPC_SHARED_SUSTAINED_METHOD_CALLS_PER_SECOND'),
        { minimum: 0 },
      ),
      peakMethodCallsPerSecond: parseNumber(
        'RPC_SHARED_PEAK_METHOD_CALLS_PER_SECOND',
        get('RPC_SHARED_PEAK_METHOD_CALLS_PER_SECOND'),
        { minimum: 0 },
      ),
      responseUnitsPerQuotaWindow: {
        day: parseNumber(
          'RPC_SHARED_RESPONSE_UNITS_PER_DAY',
          get('RPC_SHARED_RESPONSE_UNITS_PER_DAY'),
          { integer: true, minimum: 0 },
        ),
        month: parseNumber(
          'RPC_SHARED_RESPONSE_UNITS_PER_MONTH',
          get('RPC_SHARED_RESPONSE_UNITS_PER_MONTH'),
          { integer: true, minimum: 0 },
        ),
      },
    },
    retryAmplificationFactor: parseNumber(
      'RPC_RETRY_AMPLIFICATION_FACTOR',
      get('RPC_RETRY_AMPLIFICATION_FACTOR'),
      { minimum: 1 },
    ),
    headroomPercent: parseNumber(
      'RPC_CAPACITY_HEADROOM_PERCENT',
      get('RPC_CAPACITY_HEADROOM_PERCENT'),
      { minimum: 1, maximum: 90 },
    ),
  }
}

function loadApiKeyTransport(
  value: string | undefined,
): SolidRpcApiKeyTransport {
  const transport = optionalValue(value) ?? 'x-api-key'
  if (transport !== 'x-api-key' && transport !== 'bearer') {
    throw new ConfigurationError(
      'SOLIDRPC_API_KEY_TRANSPORT must be x-api-key or bearer',
    )
  }
  return transport
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
  options: { includeCapacityProfile?: boolean } = {},
): MigrationConfig {
  const chainId = parseChainId(environment.CHAIN_ID)
  const apiKey = environment.SOLIDRPC_API_KEY?.trim()
  const customerJwt = optionalValue(environment.SOLIDRPC_CUSTOMER_JWT)
  const customerJwtRequired =
    optionalValue(environment.SOLIDRPC_CUSTOMER_JWT_REQUIRED) === undefined
      ? false
      : parseBoolean(
          'SOLIDRPC_CUSTOMER_JWT_REQUIRED',
          optionalValue(environment.SOLIDRPC_CUSTOMER_JWT_REQUIRED) as string,
        )

  return {
    chainId,
    legacyRpcUrl: requireLegacyUrl(environment.LEGACY_RPC_URL),
    solidRpcApiKey: apiKey || undefined,
    solidRpcApiKeyTransport: loadApiKeyTransport(
      environment.SOLIDRPC_API_KEY_TRANSPORT,
    ),
    ...(customerJwt === undefined
      ? {}
      : { solidRpcCustomerAuthorization: `Bearer ${customerJwt}` }),
    solidRpcCustomerAuthorizationRequired: customerJwtRequired,
    solidRpcUrl: `https://rpc.solidrpc.io/evm/${chainId}`,
    catalogUrl: DEFAULT_CATALOG_URL,
    qualificationFile: DEFAULT_QUALIFICATION_FILE,
    ...(options.includeCapacityProfile === true
      ? { capacityTrafficProfile: loadCapacityTrafficProfile(environment) }
      : {}),
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

export function requireCapacityTrafficProfile(
  config: MigrationConfig,
): CapacityTrafficProfile {
  if (!config.capacityTrafficProfile) {
    throw new MissingCapacityProfileError()
  }
  return config.capacityTrafficProfile
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
