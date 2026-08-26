import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { toHex, type Hash, type Hex } from 'viem'

export type RpcRequestRecord = {
  method: string
  params: unknown[]
  apiKey?: string
  authorization?: string
}

export type MockRpcServerOptions = {
  blockNumber?: bigint
  blockHash?: Hash | null
  balance?: bigint
  transactionHash?: Hash
  chainId?: number
  responseHeaders?: Record<string, string>
  omitLimitHeaders?: boolean
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

const DEFAULT_LIMIT_HEADERS = {
  'X-RateLimit-Limit': '100',
  'X-RateLimit-Burst': '200',
  'X-RateLimit-Remaining': '199',
  'X-RateLimit-Reset': '1',
  'X-Quota-Limit': '1000000',
  'X-Quota-Window': 'day',
  'X-Quota-Used': '1',
  'X-Quota-Remaining': '999999',
  'X-Quota-Reset': '43200',
}

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
    case 'eth_chainId':
      return toHex(options.chainId ?? 1)
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

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string>,
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
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
      const authorizationHeader = request.headers.authorization
      const authorization = Array.isArray(authorizationHeader)
        ? authorizationHeader[0]
        : authorizationHeader
      requests.push({
        method: payload.method,
        params,
        ...(apiKey ? { apiKey } : {}),
        ...(authorization ? { authorization } : {}),
      })

      const headers = options.omitLimitHeaders
        ? { ...(options.responseHeaders ?? {}) }
        : { ...DEFAULT_LIMIT_HEADERS, ...(options.responseHeaders ?? {}) }

      const result = rpcResult(payload.method, options)
      if (result === undefined) {
        sendJson(
          response,
          200,
          {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: -32601, message: 'Method not found' },
          },
          headers,
        )
        return
      }

      sendJson(
        response,
        200,
        {
          jsonrpc: '2.0',
          id: payload.id,
          result,
        },
        headers,
      )
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error instanceof Error ? error.message : String(error) },
        {},
      )
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
