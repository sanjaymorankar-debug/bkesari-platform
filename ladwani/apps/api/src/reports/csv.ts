/** Minimal flat-object-array → CSV serializer. Escapes quotes/commas/newlines per RFC 4180. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))]
  return lines.join('\n')
}
