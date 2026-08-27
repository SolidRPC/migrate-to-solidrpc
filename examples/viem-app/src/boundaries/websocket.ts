export type WebSocketBoundary = {
  kind: 'websocket-subscription'
  configurationReference: string
  disposition: 'separate-migration-decision'
  automaticHttpFallback: false
}

export function websocketBoundary(
  configurationReference: string,
): WebSocketBoundary {
  return {
    kind: 'websocket-subscription',
    configurationReference,
    disposition: 'separate-migration-decision',
    automaticHttpFallback: false,
  }
}
