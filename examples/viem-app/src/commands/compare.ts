import 'dotenv/config'
import { runCommand } from '../command'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createMigrationApp } from '../migrationApp'

await runCommand(async () => {
  const config = loadMigrationConfig()
  const app = createMigrationApp(config)
  const result = await app.compareBalance(loadAccountAddress())

  process.stdout.write(`${stringifyResult(result)}\n`)
  if (result.status !== 'match') {
    process.exitCode = 2
  }
})
