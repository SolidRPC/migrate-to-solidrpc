import 'dotenv/config'
import { runCommand } from '../command'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createQualifiedReadReplacementApp } from '../migrationApp'

await runCommand(async () => {
  const config = loadMigrationConfig(process.env, {
    includeCapacityProfile: true,
  })
  const address = loadAccountAddress()
  const app = await createQualifiedReadReplacementApp(config, address)
  const result = await app.readBalance(address)

  process.stdout.write(
    `${stringifyResult({
      mode: 'partial-read-replace',
      retainedLegacyMethods: ['eth_sendRawTransaction'],
      ...result,
    })}\n`,
  )
})
