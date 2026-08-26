import {
  isHash,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem'
import { qualifyCatalogCoverage } from './catalog'
import { requireSolidRpcApiKey } from './config'
import {
  createQualificationEvidence,
  readValidQualificationEvidence,
  writeQualificationEvidence,
} from './qualification'
import { RpcClients } from './rpcClients'
import type {
  BalanceComparison,
  BalanceRead,
  MigrationConfig,
  MigrationDependencies,
  QualificationEvidence,
  RpcProvider,
  SubmittedTransaction,
} from './types'

type RpcBlock = { hash: Hex | null } | null

export class MigrationApp {
  readonly #config: MigrationConfig
  readonly #clients: RpcClients
  readonly #dependencies: MigrationDependencies

  constructor(
    config: MigrationConfig,
    dependencies: MigrationDependencies = {},
  ) {
    this.#config = config
    this.#clients = new RpcClients(config)
    this.#dependencies = dependencies
  }

  async readBalance(address: Address): Promise<BalanceRead> {
    const balance = await this.#clients.public('legacy').getBalance({ address })
    return { provider: 'legacy', address, balance }
  }

  async submitSignedTransaction(
    serializedTransaction: Hex,
  ): Promise<SubmittedTransaction> {
    const transactionHash = await this.#clients
      .wallet('legacy')
      .sendRawTransaction({ serializedTransaction })

    return { provider: 'legacy', transactionHash }
  }

  async compareBalance(address: Address): Promise<BalanceComparison> {
    await qualifyCatalogCoverage(this.#config, this.#dependencies)
    return this.#compareBalanceAfterCatalog(address)
  }

  async qualifyReplacement(address: Address): Promise<{
    evidence: QualificationEvidence
    path: string
  }> {
    const catalog = await qualifyCatalogCoverage(
      this.#config,
      this.#dependencies,
    )
    const comparison = await this.#compareBalanceAfterCatalog(address)
    if (comparison.status !== 'match') {
      throw new Error(
        `SolidRPC replacement qualification requires a matching comparison (received ${comparison.status})`,
      )
    }

    const evidence = createQualificationEvidence(
      this.#config,
      address,
      catalog,
      comparison,
      this.#dependencies,
    )
    const path = await writeQualificationEvidence(this.#config, evidence)
    return { evidence, path }
  }

  async #compareBalanceAfterCatalog(
    address: Address,
  ): Promise<BalanceComparison> {
    requireSolidRpcApiKey(this.#config)
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
        productionProvider: 'legacy',
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
      productionProvider: 'legacy',
      productionResult: legacyResult,
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

class QualifiedReplacementApp {
  readonly #clients: RpcClients

  constructor(config: MigrationConfig) {
    this.#clients = new RpcClients(config)
  }

  async readBalance(address: Address): Promise<BalanceRead> {
    const balance = await this.#clients.public('solidrpc').getBalance({ address })
    return { provider: 'solidrpc', address, balance }
  }

  async submitSignedTransaction(
    serializedTransaction: Hex,
  ): Promise<SubmittedTransaction> {
    const transactionHash = await this.#clients
      .wallet('solidrpc')
      .sendRawTransaction({ serializedTransaction })
    return { provider: 'solidrpc', transactionHash }
  }
}

export function createMigrationApp(
  config: MigrationConfig,
  dependencies: MigrationDependencies = {},
): MigrationApp {
  return new MigrationApp(config, dependencies)
}

export async function createQualifiedReplacementApp(
  config: MigrationConfig,
  address: Address,
  dependencies: MigrationDependencies = {},
): Promise<QualifiedReplacementApp> {
  requireSolidRpcApiKey(config)
  await readValidQualificationEvidence(config, address, dependencies)
  return new QualifiedReplacementApp(config)
}

export function providerLabel(provider: RpcProvider): string {
  return provider === 'solidrpc' ? 'SolidRPC' : 'legacy provider'
}
