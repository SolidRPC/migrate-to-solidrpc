import {
  createPublicClient,
  http,
  isHash,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { authenticationHeaders } from './config'
import type {
  JsonRpcRequest,
  RawStateChangeResult,
  ReadResult,
  SolidRpcConfig,
  StateChangingMethod,
  SubmittedTransaction,
} from './types'

export class SolidRpcRequestError extends Error {
  override readonly name = 'SolidRpcRequestError'
}

type UnsafeRequest = (request: JsonRpcRequest) => Promise<RawStateChangeResult>

export class SolidRpc {
  readonly #client: PublicClient

  constructor(config: SolidRpcConfig) {
    this.#client = createPublicClient({
      transport: http(config.rpcUrl, {
        fetchOptions: { headers: authenticationHeaders(config) },
        retryCount: 0,
        timeout: config.requestTimeoutMs,
      }),
    })
  }

  async getLatestBlockNumber(): Promise<bigint> {
    try {
      return await this.#client.getBlockNumber()
    } catch {
      throw new SolidRpcRequestError('SolidRPC eth_blockNumber request failed')
    }
  }

  async getNativeBalance(address: Address): Promise<ReadResult> {
    try {
      const balance = await this.#client.getBalance({ address })
      return { provider: 'solidrpc', address, balance }
    } catch {
      throw new SolidRpcRequestError('SolidRPC eth_getBalance request failed')
    }
  }

  async submitSignedRawTransaction(
    serializedTransaction: Hex,
  ): Promise<SubmittedTransaction> {
    const result = await this.#requestStateChange('eth_sendRawTransaction', [
      serializedTransaction,
    ])
    if (typeof result !== 'string' || !isHash(result)) {
      throw new SolidRpcRequestError(
        'SolidRPC eth_sendRawTransaction returned an invalid transaction hash',
      )
    }
    return { provider: 'solidrpc', transactionHash: result }
  }

  async requestStateChange(
    method: Exclude<StateChangingMethod, 'eth_sendRawTransaction'>,
    params: readonly unknown[],
  ): Promise<RawStateChangeResult> {
    return this.#requestStateChange(method, params)
  }

  async #requestStateChange(
    method: StateChangingMethod,
    params: readonly unknown[],
  ): Promise<RawStateChangeResult> {
    try {
      const request = this.#client.request.bind(this.#client) as unknown as UnsafeRequest
      return await request({ method, params })
    } catch {
      throw new SolidRpcRequestError(
        `SolidRPC ${method} failed; the state-changing request was not retried`,
      )
    }
  }
}
