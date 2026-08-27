import type { Address, Hash, Hex } from 'viem'

export type SolidRpcConfig = {
  chainId: number
  rpcUrl: string
  catalogUrl: string
  apiKey: string
  apiKeyReference: string
  accountAddress: Address
  requestTimeoutMs: number
  explicitRepositoryLimits: ExplicitRepositoryLimits
}

export type ExplicitRepositoryLimits = {
  largestBatch?: number
  maximumRequestsPerSecond?: number
  maximumConcurrentRequests?: number
  maximumResponseUnitsPerWindow?: number
}

export type PlanLimits = {
  ratePerSecond: number
  burst: number
  remaining: number
  rateResetSeconds: number
  quotaLimit: number
  quotaWindow: 'day' | 'month'
  quotaUsed: number
  quotaRemaining: number
  quotaResetSeconds: number
}

export type CatalogCoverage = {
  chainId: number
  name?: string
  status: 'live'
  methodFamilies: string[]
  nodeTypes: string[]
}

export type PrototypeSmokeResult = {
  status: 'qualified' | 'blocked'
  applicationClass: 'prototype'
  authenticated: true
  endpoint: string
  apiKeyReference: string
  catalog: CatalogCoverage
  observedChainId: number
  observedBlockNumber: string
  observedBalanceAtStableBlock: string
  planLimits: PlanLimits
  productionCapacityProven: false
  blockers: string[]
  advisories: string[]
}

export type ReadResult = {
  provider: 'solidrpc'
  address: Address
  balance: bigint
}

export type StateChangingMethod =
  | 'eth_sendRawTransaction'
  | 'eth_sendTransaction'
  | 'personal_sign'

export type SubmittedTransaction = {
  provider: 'solidrpc'
  transactionHash: Hash
}

export type JsonRpcRequest = {
  method: StateChangingMethod
  params: readonly unknown[]
}

export type ApplicationClass = 'prototype' | 'production' | 'unknown'

export type ProductionFacts = {
  peakRequestsPerSecond: number
  quotaWindowUsage: number
  largestBatch: number
  requiredNetworks: number[]
  methodFamilies: string[]
  oldestRequiredBlock: bigint | 'latest-only'
  timeoutMilliseconds: number
  ambiguousWritePolicy: 'never-retry'
}

export type ProductionEvidenceSource = {
  source: string
  facts: Partial<ProductionFacts>
}

export type RoutingDisposition = {
  applyLocalChange: boolean
  activeCompatibleRoute: 'current' | 'solidrpc'
  productionStateChanged: false
}

export type QualificationDecision =
  | {
      status: 'qualified'
      applicationClass: 'prototype' | 'production'
      questions: []
      missingFacts: []
      discoveredFrom: string[]
      routing: RoutingDisposition
    }
  | {
      status: 'needs-classification'
      applicationClass: 'unknown'
      questions: [string]
      missingFacts: []
      discoveredFrom: []
      routing: RoutingDisposition
    }
  | {
      status: 'needs-input' | 'blocked'
      applicationClass: 'prototype' | 'production'
      questions: [] | [string]
      missingFacts: (keyof ProductionFacts)[]
      discoveredFrom: string[]
      blockers: string[]
      routing: RoutingDisposition
    }

export type RpcDependencies = {
  fetch?: typeof globalThis.fetch
}

export type RawStateChangeResult = Hex | string | boolean | null | object
