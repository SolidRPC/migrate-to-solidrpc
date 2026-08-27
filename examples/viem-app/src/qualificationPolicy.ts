import type {
  ApplicationClass,
  ProductionEvidenceSource,
  ProductionFacts,
  QualificationDecision,
  RoutingDisposition,
} from './types'

const REQUIRED_PRODUCTION_FACTS = [
  'peakRequestsPerSecond',
  'quotaWindowUsage',
  'largestBatch',
  'requiredNetworks',
  'methodFamilies',
  'oldestRequiredBlock',
  'timeoutMilliseconds',
  'ambiguousWritePolicy',
] as const satisfies readonly (keyof ProductionFacts)[]

const FACT_LABELS: Record<keyof ProductionFacts, string> = {
  peakRequestsPerSecond: 'peak request rate',
  quotaWindowUsage: 'quota-window usage',
  largestBatch: 'largest JSON-RPC batch',
  requiredNetworks: 'required network chain IDs',
  methodFamilies: 'required method families',
  oldestRequiredBlock: 'oldest required historical block or latest-only',
  timeoutMilliseconds: 'request timeout behavior',
  ambiguousWritePolicy: 'ambiguous-write retry behavior',
}

const unchangedRouting = (): RoutingDisposition => ({
  applyLocalChange: false,
  activeCompatibleRoute: 'current',
  productionStateChanged: false,
})

const migratedRouting = (): RoutingDisposition => ({
  applyLocalChange: true,
  activeCompatibleRoute: 'solidrpc',
  productionStateChanged: false,
})

export function classifyApplication(input: {
  explicit?: 'prototype' | 'production'
  productionSignals?: readonly string[]
  prototypeSignals?: readonly string[]
}): ApplicationClass {
  if (input.explicit) {
    return input.explicit
  }
  const production = (input.productionSignals?.length ?? 0) > 0
  const prototype = (input.prototypeSignals?.length ?? 0) > 0
  if (production === prototype) {
    return 'unknown'
  }
  return production ? 'production' : 'prototype'
}

export function discoverProductionFacts(
  sources: readonly ProductionEvidenceSource[],
): {
  facts: Partial<ProductionFacts>
  discoveredFrom: string[]
} {
  const facts: Partial<ProductionFacts> = {}
  const discoveredFrom: string[] = []
  for (const source of sources) {
    let used = false
    for (const key of REQUIRED_PRODUCTION_FACTS) {
      if (facts[key] === undefined && source.facts[key] !== undefined) {
        Object.assign(facts, { [key]: source.facts[key] })
        used = true
      }
    }
    if (used) {
      discoveredFrom.push(source.source)
    }
  }
  return { facts, discoveredFrom }
}

function validFact(key: keyof ProductionFacts, value: unknown): boolean {
  switch (key) {
    case 'requiredNetworks':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => Number.isSafeInteger(item) && item > 0)
      )
    case 'methodFamilies':
      return (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === 'string' && item.length > 0)
      )
    case 'oldestRequiredBlock':
      return value === 'latest-only' || (typeof value === 'bigint' && value >= 0n)
    case 'ambiguousWritePolicy':
      return value === 'never-retry'
    case 'timeoutMilliseconds':
      return Number.isFinite(value) && Number(value) > 0
    default:
      return Number.isFinite(value) && Number(value) >= 0
  }
}

export function qualifyMigration(input: {
  applicationClass: ApplicationClass
  evidenceSources?: readonly ProductionEvidenceSource[]
  gateFailures?: readonly string[]
}): QualificationDecision {
  const failures = [...(input.gateFailures ?? [])]
  if (input.applicationClass === 'unknown') {
    return {
      status: 'needs-classification',
      applicationClass: 'unknown',
      questions: ['Does this application currently serve production traffic?'],
      missingFacts: [],
      discoveredFrom: [],
      routing: unchangedRouting(),
    }
  }

  if (input.applicationClass === 'prototype') {
    if (failures.length > 0) {
      return {
        status: 'blocked',
        applicationClass: 'prototype',
        questions: [],
        missingFacts: [],
        discoveredFrom: [],
        blockers: failures,
        routing: unchangedRouting(),
      }
    }
    return {
      status: 'qualified',
      applicationClass: 'prototype',
      questions: [],
      missingFacts: [],
      discoveredFrom: [],
      routing: migratedRouting(),
    }
  }

  const discovery = discoverProductionFacts(input.evidenceSources ?? [])
  const missingFacts = REQUIRED_PRODUCTION_FACTS.filter(
    (key) => !validFact(key, discovery.facts[key]),
  )
  if (missingFacts.length > 0) {
    const labels = missingFacts.map((key) => FACT_LABELS[key])
    return {
      status: 'needs-input',
      applicationClass: 'production',
      questions: [
        `To qualify the production cutover, I still need ${labels.join(', ')}. Where can I find those measurements or configurations?`,
      ],
      missingFacts: [...missingFacts],
      discoveredFrom: discovery.discoveredFrom,
      blockers: labels,
      routing: unchangedRouting(),
    }
  }
  if (failures.length > 0) {
    return {
      status: 'blocked',
      applicationClass: 'production',
      questions: [],
      missingFacts: [],
      discoveredFrom: discovery.discoveredFrom,
      blockers: failures,
      routing: unchangedRouting(),
    }
  }

  return {
    status: 'qualified',
    applicationClass: 'production',
    questions: [],
    missingFacts: [],
    discoveredFrom: discovery.discoveredFrom,
    routing: migratedRouting(),
  }
}

export function applyQualifiedLocalChange<T>(
  decision: QualificationDecision,
  unchanged: T,
  change: (current: T) => T,
): T {
  return decision.status === 'qualified' ? change(unchanged) : unchanged
}
