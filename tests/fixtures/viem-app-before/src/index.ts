import { formatEther, getAddress } from "viem"
import { loadPrimaryHttpConfig } from "./config"
import { PrimaryRpc } from "./provider"

const rpc = new PrimaryRpc(loadPrimaryHttpConfig())
const latestBlock = await rpc.getLatestBlockNumber()
console.log(`latest block: ${latestBlock}`)

const addressInput = process.argv[2]
if (addressInput) {
  const address = getAddress(addressInput)
  const balance = await rpc.getNativeBalance(address)
  console.log(`${address}: ${formatEther(balance)} ETH`)
}
