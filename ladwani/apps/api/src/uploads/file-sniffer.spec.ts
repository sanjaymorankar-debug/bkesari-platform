import { sniffFileType } from './file-sniffer'

describe('sniffFileType', () => {
  it('identifies a JPEG by its magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffFileType(buf)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' })
  })

  it('identifies a PNG by its magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    expect(sniffFileType(buf)).toEqual({ mimeType: 'image/png', extension: 'png' })
  })

  it('identifies a WEBP by its RIFF/WEBP container markers', () => {
    const buf = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])
    expect(sniffFileType(buf)).toEqual({ mimeType: 'image/webp', extension: 'webp' })
  })

  it('identifies a PDF by its header', () => {
    const buf = Buffer.from('%PDF-1.4\n...')
    expect(sniffFileType(buf)).toEqual({ mimeType: 'application/pdf', extension: 'pdf' })
  })

  it('refuses to guess when the declared type is a lie — e.g. an executable renamed to .jpg', () => {
    const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00]) // MZ header
    expect(sniffFileType(exeBuf)).toBeNull()
  })

  it('rejects an empty or truncated buffer rather than matching by accident', () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull()
    expect(sniffFileType(Buffer.from([0xff]))).toBeNull()
  })
})
