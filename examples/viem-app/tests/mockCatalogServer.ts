import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export const LIVE_ETHEREUM_CATALOG = [
  {
    chainId: 1,
    name: 'Ethereum',
    status: 'live',
    nodeTypes: ['full', 'archive'],
    methods: ['standard', 'trace', 'debug'],
  },
]

export async function startMockCatalogServer(options: {
  status?: number
  payload?: unknown
} = {}): Promise<{
  url: string
  requests: () => number
  close: () => Promise<void>
}> {
  let requestCount = 0
  const server = createServer((_request, response) => {
    requestCount += 1
    response.writeHead(options.status ?? 200, {
      'content-type': 'application/json',
    })
    response.end(JSON.stringify(options.payload ?? LIVE_ETHEREUM_CATALOG))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requestCount,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}
