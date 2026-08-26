import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { resolveSolidRpcAuthentication } from './authentication'
import type { MigrationConfig, RpcProvider } from './types'

export class RpcClients {
  readonly #config: MigrationConfig
  readonly #publicClients = new Map<RpcProvider, PublicClient>()
  readonly #walletClients = new Map<RpcProvider, WalletClient>()

  constructor(config: MigrationConfig) {
    this.#config = config
  }

  public(provider: RpcProvider): PublicClient {
    const current = this.#publicClients.get(provider)
    if (current) {
      return current
    }

    const client = createPublicClient({ transport: this.#transport(provider) })
    this.#publicClients.set(provider, client)
    return client
  }

  wallet(provider: RpcProvider): WalletClient {
    const current = this.#walletClients.get(provider)
    if (current) {
      return current
    }

    const client = createWalletClient({ transport: this.#transport(provider) })
    this.#walletClients.set(provider, client)
    return client
  }

  #transport(provider: RpcProvider) {
    const timeout = this.#config.requestTimeoutMs ?? 10_000

    if (provider === 'legacy') {
      return http(this.#config.legacyRpcUrl, { retryCount: 0, timeout })
    }

    const authentication = resolveSolidRpcAuthentication(this.#config)
    const url =
      this.#config.solidRpcUrl ??
      `https://rpc.solidrpc.io/evm/${this.#config.chainId}`

    return http(url, {
      fetchOptions: { headers: authentication.headers },
      retryCount: 0,
      timeout,
    })
  }
}
