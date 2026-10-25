import { createHmac, timingSafeEqual } from 'crypto'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { Injectable } from '@nestjs/common'
import type { FileStorage } from './file-storage.interface'

const STORAGE_ROOT = join(process.cwd(), 'uploads-dev')

/**
 * Local-disk stand-in for Cloudflare R2 (docs/18 §1). There is no real
 * object storage reachable in this environment, so "presigned URLs" are
 * just this API's own routes, and download-URL expiry is enforced with an
 * HMAC signature + embedded timestamp instead of a real short-lived R2 URL
 * — the same signed-and-verified-server-side pattern as the M4 dev payment
 * gateway, so the expiry/signature-checking code path is real even though
 * the storage backend is a stub.
 */
@Injectable()
export class DevFileStorageService implements FileStorage {
  readonly code = 'DEV'

  private get secret(): string {
    return process.env.DEV_UPLOAD_SIGNING_SECRET ?? 'dev-upload-signing-secret'
  }

  async getUploadUrl(key: string): Promise<{ url: string }> {
    return { url: `/api/v1/uploads/dev-put/${encodeURIComponent(key)}` }
  }

  async getDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Date.now() + expiresInSeconds * 1000
    const signature = this.sign(key, expiresAt)
    return `/api/v1/uploads/dev-get/${encodeURIComponent(key)}?exp=${expiresAt}&sig=${signature}`
  }

  verifyDownloadSignature(key: string, expiresAt: number, signature: string): boolean {
    if (Date.now() > expiresAt) return false
    const expected = this.sign(key, expiresAt)
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async writeBytes(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, data)
  }

  async readBytes(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  private sign(key: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${key}:${expiresAt}`).digest('hex')
  }

  private pathFor(key: string): string {
    // Keys are always server-generated cuids (see UploadsService.presign) — never derived
    // from client input — so there is no path-traversal surface here to sanitize against.
    return join(STORAGE_ROOT, key)
  }
}
