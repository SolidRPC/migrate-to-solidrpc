const URL = /https?:\/\/[^\s"'<>]+/gi
const API_KEY = /ak_[0-9a-f]{64}/gi
const BEARER_TOKEN = /\bBearer\s+[^\s,]+/gi
const JWT = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const LONG_HEX = /\b0x[0-9a-f]{32,}\b/gi

export function formatCommandError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? 'Unknown command failure'
  return firstLine
    .replace(URL, '[redacted-url]')
    .replace(API_KEY, '[redacted-api-key]')
    .replace(BEARER_TOKEN, 'Bearer [redacted-token]')
    .replace(JWT, '[redacted-jwt]')
    .replace(LONG_HEX, '[redacted-hex]')
    .slice(0, 500)
}

export async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    process.stderr.write(`Command failed: ${formatCommandError(error)}\n`)
    process.exitCode = 1
  }
}
