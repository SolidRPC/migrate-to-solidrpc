import 'dotenv/config'
import { loadSolidRpcConfig } from '../config'
import { runPrototypeSmoke } from '../smoke'

try {
  const result = await runPrototypeSmoke(loadSolidRpcConfig())
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'blocked') {
    process.exitCode = 2
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'SolidRPC smoke test failed')
  process.exitCode = 1
}
