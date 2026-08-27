import { createHmac, timingSafeEqual } from 'node:crypto'

export type AdvancedCandidateEvidence = {
  schemaVersion: 1
  candidate: 'solidrpc'
  configurationFingerprint: string
  issuedAt: string
  expiresAt: string
  signature: string
}

type EvidencePayload = Omit<AdvancedCandidateEvidence, 'signature'>

function sign(payload: EvidencePayload, signingSecret: string): string {
  return createHmac('sha256', signingSecret)
    .update(JSON.stringify(payload))
    .digest('hex')
}

export function createAdvancedCandidateEvidence(input: {
  configurationFingerprint: string
  signingSecret: string
  issuedAt: Date
  expiresAt: Date
}): AdvancedCandidateEvidence {
  const payload: EvidencePayload = {
    schemaVersion: 1,
    candidate: 'solidrpc',
    configurationFingerprint: input.configurationFingerprint,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  }
  return { ...payload, signature: sign(payload, input.signingSecret) }
}

function candidateEnabled(input: {
  evidence?: AdvancedCandidateEvidence
  expectedFingerprint: string
  signingSecret: string
  now: Date
}): { enabled: true } | { enabled: false; reason: string } {
  const evidence = input.evidence
  if (!evidence) {
    return { enabled: false, reason: 'candidate-evidence-missing' }
  }
  const payload: EvidencePayload = {
    schemaVersion: evidence.schemaVersion,
    candidate: evidence.candidate,
    configurationFingerprint: evidence.configurationFingerprint,
    issuedAt: evidence.issuedAt,
    expiresAt: evidence.expiresAt,
  }
  const expected = Buffer.from(sign(payload, input.signingSecret), 'hex')
  const supplied = Buffer.from(evidence.signature, 'hex')
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied) ||
    evidence.configurationFingerprint !== input.expectedFingerprint
  ) {
    return { enabled: false, reason: 'candidate-evidence-invalid' }
  }
  const expiresAt = Date.parse(evidence.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= input.now.getTime()) {
    return { enabled: false, reason: 'candidate-evidence-expired' }
  }
  return { enabled: true }
}

export function selectAdvancedDualRoute<T>(input: {
  existingRollbackRoute: T
  solidRpcCandidateRoute: T
  evidence?: AdvancedCandidateEvidence
  expectedFingerprint: string
  signingSecret: string
  now: Date
}):
  | { active: 'solidrpc-candidate'; route: T }
  | { active: 'existing-rollback'; route: T; candidateDisabledReason: string } {
  const eligibility = candidateEnabled(input)
  if (!eligibility.enabled) {
    return {
      active: 'existing-rollback',
      route: input.existingRollbackRoute,
      candidateDisabledReason: eligibility.reason,
    }
  }
  return { active: 'solidrpc-candidate', route: input.solidRpcCandidateRoute }
}
