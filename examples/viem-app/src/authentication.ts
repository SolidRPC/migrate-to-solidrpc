import { ConfigurationError, requireSolidRpcApiKey, solidRpcUrl } from './config'
import type { MigrationConfig, SolidRpcApiKeyTransport } from './types'

export type SolidRpcAuthentication = {
  transport: SolidRpcApiKeyTransport
  headers: Record<string, string>
  customerJwtExpiresAtEpochSeconds?: number
}

const CANONICAL_API_KEY = /ak_[0-9a-f]{64}/i
export const CUSTOMER_JWT_SAFETY_SKEW_SECONDS = 30

function decodeForCredentialCheck(value: string): string {
  let decoded = value
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) {
        return decoded
      }
      decoded = next
    } catch {
      return decoded
    }
  }
  return decoded
}

function assertCleanOfficialEndpoint(value: string, chainId: number): void {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new ConfigurationError('solidRpcUrl must be a valid URL')
  }
  const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname !== 'rpc.solidrpc.io') {
    return
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.port !== '' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.pathname !== `/evm/${chainId}` ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new ConfigurationError(
      `Authenticated SolidRPC traffic must use the clean endpoint https://rpc.solidrpc.io/evm/${chainId}`,
    )
  }
}

function customerBearerToken(value: string): string {
  const match = /^Bearer ([^\s,]+)$/i.exec(value.trim())
  if (!match) {
    throw new ConfigurationError(
      'solidRpcCustomerAuthorization must be a single Bearer token',
    )
  }
  return match[1]
}

function customerJwtExpiryEpochSeconds(value: string): number {
  const token = customerBearerToken(value)
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new ConfigurationError(
      'solidRpcCustomerAuthorization must contain a signed JWT',
    )
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] as string, 'base64url').toString('utf8'),
    ) as { exp?: unknown }
    if (!Number.isSafeInteger(payload.exp) || Number(payload.exp) <= 0) {
      throw new Error('invalid exp')
    }
    return Number(payload.exp)
  } catch {
    throw new ConfigurationError(
      'solidRpcCustomerAuthorization JWT must contain a numeric exp claim',
    )
  }
}

export function resolveSolidRpcAuthentication(
  config: MigrationConfig,
): SolidRpcAuthentication {
  const apiKey = requireSolidRpcApiKey(config)
  const transport = config.solidRpcApiKeyTransport ?? 'x-api-key'
  const url = solidRpcUrl(config)
  assertCleanOfficialEndpoint(url, config.chainId)
  const decodedUrl = decodeForCredentialCheck(url)
  if (
    decodedUrl.includes(apiKey) ||
    CANONICAL_API_KEY.test(decodedUrl)
  ) {
    throw new ConfigurationError(
      'Do not combine URL authentication with an API-key header transport',
    )
  }

  const customerAuthorization = config.solidRpcCustomerAuthorization?.trim()
  if (config.solidRpcCustomerAuthorizationRequired && !customerAuthorization) {
    throw new ConfigurationError(
      'A customer JWT is required but solidRpcCustomerAuthorization is missing',
    )
  }

  if (transport === 'bearer') {
    if (customerAuthorization || config.solidRpcCustomerAuthorizationRequired) {
      throw new ConfigurationError(
        'Bearer API-key authentication cannot be used when Authorization is needed for a customer JWT',
      )
    }
    return {
      transport,
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  }

  const headers: Record<string, string> = { 'X-API-Key': apiKey }
  if (customerAuthorization) {
    const token = customerBearerToken(customerAuthorization)
    if (token === apiKey || CANONICAL_API_KEY.test(token)) {
      throw new ConfigurationError(
        'Do not configure the API key in both X-API-Key and Authorization',
      )
    }
    headers.Authorization = customerAuthorization
    return {
      transport,
      headers,
      customerJwtExpiresAtEpochSeconds:
        customerJwtExpiryEpochSeconds(customerAuthorization),
    }
  }
  return { transport, headers }
}
