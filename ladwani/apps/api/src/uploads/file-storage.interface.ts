export const FILE_STORAGE = 'FILE_STORAGE'

/**
 * docs/18-file-storage-design.md §1 — S3-compatible object storage,
 * swappable to Cloudflare R2 in production without touching business logic.
 * The dev implementation below stores bytes on local disk and issues its
 * own API routes in place of presigned R2 URLs.
 */
export interface FileStorage {
  readonly code: string
  getUploadUrl(key: string, contentType: string): Promise<{ url: string; fields?: Record<string, string> }>
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(key: string): Promise<void>
}
