import 'dotenv/config'
import { runCommand } from '../command'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createMigrationApp } from '../migrationApp'

await runCommand(async () => {
  const config = loadMigrationConfig(process.env, {
    includeCapacityProfile: true,
  })
  const result = await createMigrationApp(config).qualifyReplacement(
    loadAccountAddress(),
  )

  process.stdout.write(
    `${stringifyResult({
      status: 'qualified-partial-read-replacement',
      retainedLegacyMethods: ['eth_sendRawTransaction'],
      evidenceFile: result.path,
      chainId: result.evidence.chainId,
      blockNumber: result.evidence.comparison.blockNumber,
      blockHash: result.evidence.comparison.blockHash,
      apiKeyTransport: result.evidence.capacity.apiKeyTransport,
      quotaWindow: result.evidence.capacity.limits.quotaWindow,
      probeUsage: result.evidence.probeUsage,
      qualifiedAt: result.evidence.qualifiedAt,
      expiresAt: result.evidence.expiresAt,
    })}\n`,
  )
})
