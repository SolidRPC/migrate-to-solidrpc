import type { Address, Hash, Hex } from 'viem'

export type RpcProvider = 'legacy' | 'solidrpc'

export type SolidRpcApiKeyTransport = 'x-api-key' | 'bearer'

export type QuotaWindow = 'day' | 'month'

export type WindowResponseUnits = Record<QuotaWindow, number>

export type CapacityTrafficProfile = {
  largestValidMethodBatch: number
  sustainedMethodCallsPerSecond: number
  peakMethodCallsPerSecond: number
  responseUnitsPerQuotaWindow: WindowResponseUnits
  sharedTraffic: {
    sustainedMethodCallsPerSecond: number
    peakMethodCallsPerSecond: number
    responseUnitsPerQuotaWindow: WindowResponseUnits
  }
  retryAmplificationFactor: number
  headroomPercent: number
}

export type MigrationConfig = {
  chainId: number
  legacyRpcUrl: string
  solidRpcApiKey?: string
  solidRpcApiKeyTransport?: SolidRpcApiKeyTransport
  solidRpcCustomerAuthorization?: string
  solidRpcCustomerAuthorizationRequired?: boolean
  solidRpcUrl?: string
  catalogUrl?: string
  qualificationFile?: string
  qualificationTtlMs?: number
  confirmationBlocks?: bigint
  requestTimeoutMs?: number
  capacityTrafficProfile?: CapacityTrafficProfile
}

export type MigrationDependencies = {
  fetch?: typeof globalThis.fetch
  now?: () => Date
}

export type BalanceRead = {
  provider: RpcProvider
  address: Address
  balance: bigint
}

export type SubmittedTransaction = {
  provider: RpcProvider
  transactionHash: Hash
}

export type SolidRpcProbeUsage = {
  rpcRequests: number
  methodCalls: number
  responseUnits: number
}

export type LiveCapacityQualification = {
  status: 'qualified'
  observedAt: string
  expiresAt: string
  apiKeyTransport: SolidRpcApiKeyTransport
  limits: {
    ratePerSecond: number
    burst: number
    remaining: number
    resetSeconds: number
    quotaLimit: number
    quotaWindow: QuotaWindow
    quotaUsed: number
    quotaRemaining: number
    quotaResetSeconds: number
  }
  trafficProfile: CapacityTrafficProfile
  calculated: {
    sustainedMethodCallsPerSecond: number
    peakMethodCallsPerSecond: number
    responseUnitsPerQuotaWindow: number
    responseUnitsUntilReset: number
    rateCapacityWithHeadroom: number
    burstCapacityWithHeadroom: number
    quotaCapacityWithHeadroom: number
  }
  probeUsage: SolidRpcProbeUsage
}

export type ComparableBalanceResult = {
  status: 'match' | 'mismatch'
  blockNumber: bigint
  blockHash: Hash
  address: Address
  productionProvider: 'legacy'
  productionResult: bigint
  legacyResult: bigint
  solidRpcResult: bigint
}

export type IncomparableBalanceResult = {
  status: 'incomparable'
  blockNumber: bigint
  address: Address
  productionProvider: 'legacy'
  reason: string
  legacyBlockHash: Hex | null
  solidRpcBlockHash: Hex | null
}

export type BalanceComparison = ComparableBalanceResult | IncomparableBalanceResult

export type CatalogCoverage = {
  fetchedAt: string
  chainId: number
  name?: string
  status: 'live'
  nodeTypes: string[]
  methods: string[]
}

export type QualificationEvidencePayload = {
  schemaVersion: 2
  kind: 'solidrpc-read-qualification'
  mode: 'partial-read-replace'
  configurationFingerprint: string
  chainId: number
  solidRpcUrl: string
  catalogUrl: string
  requiredMethodFamilies: ['standard']
  requiredNodeTypes: []
  requiredProjectChecks: {
    routingInvariant: {
      id: 'viem-sample-partial-read-routing-invariants-v3'
      required: true
      solidRpcOnlyMethods: ['eth_getBalance']
      retainedLegacyMethods: ['eth_sendRawTransaction']
    }
  }
  credentialBinding: {
    customerJwtExpiresAt: string | null
    safetySkewSeconds: 30
  }
  qualifiedAt: string
  expiresAt: string
  catalog: CatalogCoverage
  capacity: LiveCapacityQualification
  probeUsage: SolidRpcProbeUsage
  comparison: {
    method: 'eth_getBalance'
    address: Address
    blockNumber: string
    blockHash: Hash
    legacyResult: string
    solidRpcResult: string
  }
}

export type QualificationEvidence = QualificationEvidencePayload & {
  integrity: {
    algorithm: 'hmac-sha256'
    digest: string
  }
}
