export function stringifyResult(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) =>
      typeof current === 'bigint' ? current.toString() : current,
    2,
  )
}
