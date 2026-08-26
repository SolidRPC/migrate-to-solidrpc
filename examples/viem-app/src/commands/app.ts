import 'dotenv/config'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createMigrationApp } from '../migrationApp'

const config = loadMigrationConfig()
const app = createMigrationApp(config)
const result = await app.readBalance(loadAccountAddress())

process.stdout.write(`${stringifyResult(result)}\n`)
