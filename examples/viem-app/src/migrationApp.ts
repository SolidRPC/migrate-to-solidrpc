import {
  isHash,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem'
import { requireSolidRpcApiKey } from './config'
import { RpcClients } from './rpcClients'
import type {
  BalanceComparison,
  BalanceRead,
  MigrationConfig,
  RpcProvider,
  SubmittedTransaction,
} from './types'

type RpcBlock = { hash: Hex | null } | null

export class MigrationApp {
  readonly #config: MigrationConfig
  readonly #clients: RpcClients

  constructor(config: MigrationConfig) {
    if (config.primaryProvider === 'solidrpc') {
      requireSolidRpcApiKey(config)
    }

    this.#config = config
    this.#clients = new RpcClients(config)
  }

  async readBalance(address: Address): Promise<BalanceRead> {
    const provider = this.#config.primaryProvider
    const balance = await this.#clients.public(provider).getBalance({ address })
    return { provider, address, balance }
  }

  async submitSignedTransaction(
    serializedTransaction: Hex,
  ): Promise<SubmittedTransaction> {
    const provider = this.#config.primaryProvider
    const transactionHash = await this.#clients
      .wallet(provider)
      .sendRawTransaction({ serializedTransaction })

    return { provider, transactionHash }
  }

  async compareBalance(address: Address): Promise<BalanceComparison> {
    const legacy = this.#clients.public('legacy')
    const solidRpc = this.#clients.public('solidrpc')
    const [legacyHead, solidRpcHead] = await Promise.all([
      legacy.getBlockNumber(),
      solidRpc.getBlockNumber(),
    ])
    const confirmationBlocks = this.#config.confirmationBlocks ?? 12n
    const sharedHead = legacyHead < solidRpcHead ? legacyHead : solidRpcHead
    const blockNumber =
      sharedHead > confirmationBlocks ? sharedHead - confirmationBlocks : 0n
    const [legacyBlockHash, solidRpcBlockHash] = await Promise.all([
      this.#blockHash(legacy, blockNumber),
      this.#blockHash(solidRpc, blockNumber),
    ])

    if (
      legacyBlockHash === null ||
      solidRpcBlockHash === null ||
      legacyBlockHash.toLowerCase() !== solidRpcBlockHash.toLowerCase()
    ) {
      return {
        status: 'incomparable',
        blockNumber,
        address,
        productionProvider: this.#config.primaryProvider,
        reason: 'Providers did not return the same canonical block hash',
        legacyBlockHash,
        solidRpcBlockHash,
      }
    }

    const [legacyResult, solidRpcResult] = await Promise.all([
      legacy.getBalance({ address, blockNumber }),
      solidRpc.getBalance({ address, blockNumber }),
    ])

    return {
      status: legacyResult === solidRpcResult ? 'match' : 'mismatch',
      blockNumber,
      blockHash: legacyBlockHash,
      address,
      productionProvider: this.#config.primaryProvider,
      productionResult:
        this.#config.primaryProvider === 'solidrpc'
          ? solidRpcResult
          : legacyResult,
      legacyResult,
      solidRpcResult,
    }
  }

  async #blockHash(
    client: PublicClient,
    blockNumber: bigint,
  ): Promise<Hash | null> {
    const block = (await client.request({
      method: 'eth_getBlockByNumber',
      params: [toHex(blockNumber), false],
    })) as RpcBlock
    return block?.hash && isHash(block.hash) ? block.hash : null
  }
}

export function createMigrationApp(config: MigrationConfig): MigrationApp {
  return new MigrationApp(config)
}

export function providerLabel(provider: RpcProvider): string {
  return provider === 'solidrpc' ? 'SolidRPC' : 'legacy provider'
}
