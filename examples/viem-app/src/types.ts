import type { Address, Hash, Hex } from 'viem'

export type RpcProvider = 'legacy' | 'solidrpc'

export type MigrationConfig = {
  chainId: number
  legacyRpcUrl: string
  solidRpcApiKey?: string
  solidRpcUrl?: string
  catalogUrl?: string
  qualificationFile?: string
  qualificationTtlMs?: number
  confirmationBlocks?: bigint
  requestTimeoutMs?: number
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

export type QualificationEvidence = {
  schemaVersion: 1
  kind: 'solidrpc-read-qualification'
  mode: 'replace'
  configurationFingerprint: string
  chainId: number
  solidRpcUrl: string
  catalogUrl: string
  requiredMethodFamilies: ['standard']
  requiredNodeTypes: []
  requiredProjectChecks: {
    routingInvariant: {
      id: 'viem-sample-routing-invariants-v1'
      required: true
    }
  }
  qualifiedAt: string
  expiresAt: string
  catalog: CatalogCoverage
  comparison: {
    method: 'eth_getBalance'
    address: Address
    blockNumber: string
    blockHash: Hash
    legacyResult: string
    solidRpcResult: string
  }
}
