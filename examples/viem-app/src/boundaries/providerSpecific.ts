export type ProviderSpecificBoundary = {
  kind: 'provider-specific-api'
  method: string
  disposition: 'separate-migration-decision'
  automaticHttpFallback: false
}

export function providerSpecificBoundary(method: string): ProviderSpecificBoundary {
  return {
    kind: 'provider-specific-api',
    method,
    disposition: 'separate-migration-decision',
    automaticHttpFallback: false,
  }
}
