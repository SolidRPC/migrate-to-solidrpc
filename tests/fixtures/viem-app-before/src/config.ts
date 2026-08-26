export type PrimaryHttpConfig = {
  primaryRpcUrl: string
}

export type PrimarySubscriptionConfig = {
  primaryWebSocketUrl: string
}

function requireUrl(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value) {
    throw new Error(`${key} is required`)
  }

  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`${key} must be an HTTP or WebSocket URL`)
  }

  return value
}

export function loadPrimaryHttpConfig(env: NodeJS.ProcessEnv = process.env): PrimaryHttpConfig {
  return {
    primaryRpcUrl: requireUrl(env, "PRIMARY_RPC_URL"),
  }
}

export function loadPrimarySubscriptionConfig(env: NodeJS.ProcessEnv = process.env): PrimarySubscriptionConfig {
  return {
    primaryWebSocketUrl: requireUrl(env, "PRIMARY_WS_URL"),
  }
}
