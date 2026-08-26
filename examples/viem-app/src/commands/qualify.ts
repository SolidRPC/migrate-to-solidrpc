import 'dotenv/config'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createMigrationApp } from '../migrationApp'

const config = loadMigrationConfig()
const result = await createMigrationApp(config).qualifyReplacement(
  loadAccountAddress(),
)

process.stdout.write(
  `${stringifyResult({
    status: 'qualified',
    evidenceFile: result.path,
    chainId: result.evidence.chainId,
    blockNumber: result.evidence.comparison.blockNumber,
    blockHash: result.evidence.comparison.blockHash,
    qualifiedAt: result.evidence.qualifiedAt,
    expiresAt: result.evidence.expiresAt,
  })}\n`,
)
