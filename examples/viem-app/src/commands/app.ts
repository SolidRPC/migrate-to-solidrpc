import { formatEther } from 'viem'
import 'dotenv/config'
import { loadSolidRpcConfig } from '../config'
import { SolidRpc } from '../solidRpc'

try {
  const config = loadSolidRpcConfig()
  const rpc = new SolidRpc(config)
  const latestBlock = await rpc.getLatestBlockNumber()
  const result = await rpc.getNativeBalance(config.accountAddress)
  console.log(`SolidRPC block: ${latestBlock}`)
  console.log(`${result.address}: ${formatEther(result.balance)} ETH`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'SolidRPC application failed')
  process.exitCode = 1
}
