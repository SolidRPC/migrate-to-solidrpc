import type { Address, Hash, Hex } from 'viem'

export type RpcProvider = 'legacy' | 'solidrpc'

export type MigrationConfig = {
  chainId: number
  primaryProvider: RpcProvider
  legacyRpcUrl: string
  solidRpcApiKey?: string
  solidRpcUrl?: string
  confirmationBlocks?: bigint
  requestTimeoutMs?: number
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
  productionProvider: RpcProvider
  productionResult: bigint
  legacyResult: bigint
  solidRpcResult: bigint
}

export type IncomparableBalanceResult = {
  status: 'incomparable'
  blockNumber: bigint
  address: Address
  productionProvider: RpcProvider
  reason: string
  legacyBlockHash: Hex | null
  solidRpcBlockHash: Hex | null
}

export type BalanceComparison = ComparableBalanceResult | IncomparableBalanceResult
