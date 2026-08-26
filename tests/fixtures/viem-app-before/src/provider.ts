import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  type Address,
  type Hex,
} from "viem"
import { mainnet } from "viem/chains"
import type { PrimaryHttpConfig, PrimarySubscriptionConfig } from "./config"

export class PrimaryRpc {
  private readonly publicClient
  private readonly walletClient

  constructor(config: PrimaryHttpConfig) {
    const transport = http(config.primaryRpcUrl)
    this.publicClient = createPublicClient({ chain: mainnet, transport })
    this.walletClient = createWalletClient({ chain: mainnet, transport })
  }

  getLatestBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber()
  }

  getNativeBalance(address: Address): Promise<bigint> {
    return this.publicClient.getBalance({ address })
  }

  submitSignedRawTransaction(serializedTransaction: Hex): Promise<Hex> {
    return this.walletClient.sendRawTransaction({ serializedTransaction })
  }
}

export function subscribeToPrimaryBlocks(
  config: PrimarySubscriptionConfig,
  onBlockNumber: (blockNumber: bigint) => void,
): () => void {
  const client = createPublicClient({
    chain: mainnet,
    transport: webSocket(config.primaryWebSocketUrl),
  })

  return client.watchBlockNumber({ onBlockNumber })
}
