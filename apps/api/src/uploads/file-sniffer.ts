/**
 * MIME-type sniffing on the actual bytes, per docs/18-file-storage-design.md
 * §4 — a client-declared Content-Type header is never trusted on its own.
 * Deliberately hand-rolled for the small allowlist this app actually needs
 * rather than pulling in a dependency, since the magic-byte signatures for
 * these formats are short and stable.
 */

export interface SniffResult {
  mimeType: string
  extension: string
}

const SIGNATURES: { mimeType: string; extension: string; matches: (buf: Buffer) => boolean }[] = [
  { mimeType: 'image/jpeg', extension: 'jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: 'image/png', extension: 'png', matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    matches: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { mimeType: 'application/pdf', extension: 'pdf', matches: (b) => b.length >= 4 && b.subarray(0, 4).toString('ascii') === '%PDF' },
]

/** Returns null when the bytes don't match any allowlisted signature — callers must reject, never guess. */
export function sniffFileType(buffer: Buffer): SniffResult | null {
  const found = SIGNATURES.find((sig) => sig.matches(buffer))
  return found ? { mimeType: found.mimeType, extension: found.extension } : null
}
