import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
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

export type MockCatalogServerOptions = {
  status?: number
  payload?: unknown
  rawBody?: string
}

export type MockCatalogServer = {
  url: string
  requests: number
  close: () => Promise<void>
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(body)
}

export async function startMockCatalogServer(
  options: MockCatalogServerOptions = {},
): Promise<MockCatalogServer> {
  let requests = 0
  let closed = false
  const server = createServer((_request, response) => {
    requests += 1
    const body =
      options.rawBody ??
      JSON.stringify(options.payload ?? LIVE_ETHEREUM_CATALOG)
    send(response, options.status ?? 200, body)
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${address.port}`,
    get requests() {
      return requests
    },
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
