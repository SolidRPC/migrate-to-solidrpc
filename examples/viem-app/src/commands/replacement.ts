import 'dotenv/config'
import { loadAccountAddress, loadMigrationConfig } from '../config'
import { stringifyResult } from '../format'
import { createQualifiedReplacementApp } from '../migrationApp'

const config = loadMigrationConfig()
const address = loadAccountAddress()
const app = await createQualifiedReplacementApp(config, address)
const result = await app.readBalance(address)

process.stdout.write(`${stringifyResult(result)}\n`)
