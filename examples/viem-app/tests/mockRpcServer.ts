import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { toHex, type Hash, type Hex } from 'viem'

export type RpcRequestRecord = {
  method: string
  params: unknown[]
  apiKey?: string
}

export type MockRpcServerOptions = {
  blockNumber?: bigint
  blockHash?: Hash | null
  balance?: bigint
  transactionHash?: Hash
}

export type MockRpcServer = {
  url: string
  requests: RpcRequestRecord[]
  close: () => Promise<void>
}

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown[]
}

const DEFAULT_BLOCK_HASH =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash
const DEFAULT_TRANSACTION_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hash

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  request.setEncoding('utf8')
  for await (const chunk of request) {
    body += chunk
  }
  return body
}

function rpcResult(method: string, options: MockRpcServerOptions): unknown {
  switch (method) {
    case 'eth_blockNumber':
      return toHex(options.blockNumber ?? 100n)
    case 'eth_getBlockByNumber':
      return options.blockHash === null
        ? null
        : {
            number: toHex(options.blockNumber ?? 100n),
            hash: options.blockHash ?? DEFAULT_BLOCK_HASH,
          }
    case 'eth_getBalance':
      return toHex(options.balance ?? 0n)
    case 'eth_sendRawTransaction':
      return options.transactionHash ?? DEFAULT_TRANSACTION_HASH
    default:
      return undefined
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

export async function startMockRpcServer(
  options: MockRpcServerOptions = {},
): Promise<MockRpcServer> {
  const requests: RpcRequestRecord[] = []
  let closed = false
  const server = createServer(async (request, response) => {
    try {
      const payload = JSON.parse(await readBody(request)) as JsonRpcRequest
      const params = payload.params ?? []
      const apiKeyHeader = request.headers['x-api-key']
      const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader
      requests.push({
        method: payload.method,
        params,
        ...(apiKey ? { apiKey } : {}),
      })

      const result = rpcResult(payload.method, options)
      if (result === undefined) {
        sendJson(response, 200, {
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32601, message: 'Method not found' },
        })
        return
      }

      sendJson(response, 200, {
        jsonrpc: '2.0',
        id: payload.id,
        result,
      })
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      if (closed) {
        return
      }
      closed = true
      server.close()
      await once(server, 'close')
    },
  }
}

export const SAMPLE_RAW_TRANSACTION = '0x02deadbeef' as Hex
