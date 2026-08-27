import { once } from 'node:events'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toHex, type Hash, type Hex } from 'viem'

export type RecordedRequest = {
  method: string
  params: unknown[]
  apiKey?: string
}

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown[]
}

export const SAMPLE_RAW_TRANSACTION = '0x02deadbeef' as Hex
export const TRANSACTION_HASH = `0x${'ab'.repeat(32)}` as Hash

export const DEFAULT_LIMIT_HEADERS = {
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

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function startMockRpcServer(options: {
  chainId?: number
  blockNumber?: bigint
  balance?: bigint
  responseHeaders?: Record<string, string>
  destroyAfterMethods?: readonly string[]
} = {}): Promise<{
  url: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}> {
  const requests: RecordedRequest[] = []
  const server = createServer(async (request, response) => {
    const payload = JSON.parse(await body(request)) as JsonRpcRequest
    const apiKeyHeader = request.headers['x-api-key']
    const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader
    requests.push({
      method: payload.method,
      params: payload.params ?? [],
      ...(apiKey ? { apiKey } : {}),
    })

    if (options.destroyAfterMethods?.includes(payload.method)) {
      request.socket.destroy()
      return
    }

    const resultByMethod: Record<string, unknown> = {
      eth_chainId: toHex(options.chainId ?? 1),
      eth_blockNumber: toHex(options.blockNumber ?? 100n),
      eth_getBalance: toHex(options.balance ?? 10n ** 18n),
      eth_sendRawTransaction: TRANSACTION_HASH,
      eth_sendTransaction: TRANSACTION_HASH,
      personal_sign: `0x${'cd'.repeat(65)}`,
    }
    const result = resultByMethod[payload.method]
    const envelope =
      result === undefined
        ? {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: -32601, message: 'Method not found' },
          }
        : { jsonrpc: '2.0', id: payload.id, result }
    response.writeHead(200, {
      'content-type': 'application/json',
      ...DEFAULT_LIMIT_HEADERS,
      ...(options.responseHeaders ?? {}),
    })
    response.end(JSON.stringify(envelope))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}
