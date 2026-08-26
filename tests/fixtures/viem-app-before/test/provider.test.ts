import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import type { Hex } from "viem"
import { loadPrimaryHttpConfig, loadPrimarySubscriptionConfig } from "../src/config"
import { PrimaryRpc } from "../src/provider"

type JsonRpcRequest = {
  id: number
  jsonrpc: "2.0"
  method: string
  params?: unknown[]
}

const openServers: Server[] = []

async function startRpcServer(requests: JsonRpcRequest[]): Promise<string> {
  const transactionHash = `0x${"ab".repeat(32)}`
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }

    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRpcRequest
    requests.push(payload)

    const resultByMethod: Record<string, string> = {
      eth_blockNumber: "0x2a",
      eth_getBalance: "0xde0b6b3a7640000",
      eth_sendRawTransaction: transactionHash,
    }
    const result = resultByMethod[payload.method]

    response.writeHead(result ? 200 : 400, { "content-type": "application/json" })
    response.end(JSON.stringify(
      result
        ? { id: payload.id, jsonrpc: "2.0", result }
        : { error: { code: -32601, message: "Method not found" }, id: payload.id, jsonrpc: "2.0" },
    ))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  openServers.push(server)
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("mock server did not bind to a TCP port")
  }

  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe("primary RPC integration", () => {
  it("performs normal reads through PRIMARY_RPC_URL", async () => {
    const requests: JsonRpcRequest[] = []
    const primaryRpcUrl = await startRpcServer(requests)
    const rpc = new PrimaryRpc(loadPrimaryHttpConfig({ PRIMARY_RPC_URL: primaryRpcUrl }))

    await expect(rpc.getLatestBlockNumber()).resolves.toBe(42n)
    await expect(rpc.getNativeBalance("0x0000000000000000000000000000000000000000")).resolves.toBe(10n ** 18n)
    expect(requests.map(({ method }) => method)).toEqual(["eth_blockNumber", "eth_getBalance"])
  })

  it("submits a signed raw transaction exactly once", async () => {
    const requests: JsonRpcRequest[] = []
    const primaryRpcUrl = await startRpcServer(requests)
    const rpc = new PrimaryRpc({ primaryRpcUrl })
    const signedTransaction = "0x02f86b0180843b9aca008252089400000000000000000000000000000000000000008080c080a0" as Hex

    await expect(rpc.submitSignedRawTransaction(signedTransaction)).resolves.toBe(`0x${"ab".repeat(32)}`)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "eth_sendRawTransaction", params: [signedTransaction] })
  })

  it("keeps WebSocket subscription configuration separate", () => {
    expect(loadPrimarySubscriptionConfig({ PRIMARY_WS_URL: "wss://provider.example/ws" })).toEqual({
      primaryWebSocketUrl: "wss://provider.example/ws",
    })
    expect(() => loadPrimarySubscriptionConfig({})).toThrow("PRIMARY_WS_URL is required")
  })
})
