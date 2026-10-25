import { DevFileStorageService } from './dev-file-storage.service'

describe('DevFileStorageService signed download URLs', () => {
  let storage: DevFileStorageService

  beforeEach(() => {
    storage = new DevFileStorageService()
  })

  it('accepts a signature it generated itself, before expiry', async () => {
    const url = await storage.getDownloadUrl('some/key', 300)
    const params = new URLSearchParams(url.split('?')[1])
    const exp = Number(params.get('exp'))
    const sig = params.get('sig')!
    expect(storage.verifyDownloadSignature('some/key', exp, sig)).toBe(true)
  })

  it('refuses a tampered signature', async () => {
    const url = await storage.getDownloadUrl('some/key', 300)
    const params = new URLSearchParams(url.split('?')[1])
    const exp = Number(params.get('exp'))
    expect(storage.verifyDownloadSignature('some/key', exp, 'not-the-real-signature')).toBe(false)
  })

  it('refuses a signature reused for a different key', async () => {
    const url = await storage.getDownloadUrl('some/key', 300)
    const params = new URLSearchParams(url.split('?')[1])
    const exp = Number(params.get('exp'))
    const sig = params.get('sig')!
    expect(storage.verifyDownloadSignature('a-different/key', exp, sig)).toBe(false)
  })

  it('refuses a signature past its expiry', () => {
    const expiredAt = Date.now() - 1000
    const sig = (storage as unknown as { sign: (k: string, e: number) => string }).sign('some/key', expiredAt)
    expect(storage.verifyDownloadSignature('some/key', expiredAt, sig)).toBe(false)
  })
})
