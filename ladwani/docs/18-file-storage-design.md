# Phase 2.5 — File Storage Design (Concrete)

## 1. Provider: Cloudflare R2

Object storage runs off-host — Hostinger's shared MySQL/Node hosting has no S3-compatible storage of its own, and storing uploaded photos on the app server's local disk would tie photo durability to the same box that gets rebuilt/redeployed. R2 specifically because: S3-compatible API (so the `PaymentGateway`-style abstraction pattern applies here too — swappable to AWS S3 or another provider without touching business logic), no egress fees (relevant for a photo-heavy family/community app where members browse a lot of profile photos), and a free tier generous enough to cover this project's early scale.

```ts
interface FileStorage {
  getUploadUrl(key: string, contentType: string): Promise<{ url: string; fields?: Record<string,string> }>
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string>
  delete(key: string): Promise<void>
}
```

## 2. Upload Flow

```
1. Client asks the API: POST /api/v1/uploads/presign  { contentType, purpose: "PROFILE_PHOTO" }
2. API validates: file-type allowlist (jpeg/png/webp only for photos), a size ceiling per
   purpose (5MB for profile photos), and that the requester is allowed to upload for this
   purpose (e.g. can't presign a "FAMILY_PHOTO" upload for a family they're not in).
3. API returns a short-lived presigned PUT URL + the object key it generated
   (`photos/{memberId}/{cuid}.jpg` — never the client-supplied filename, avoiding path
   traversal and collisions).
4. Client uploads the file bytes DIRECTLY to R2 — the Node app never sees or proxies the
   file body, keeping upload bandwidth off the app server entirely.
5. Client confirms completion: POST /api/v1/photos { key, purpose, memberId }.
6. API queues a background job (BullMQ, or the polling fallback from §14 if Redis isn't
   available on this host) to: virus/malware-scan the object, generate a thumbnail via
   `sharp`, and only then flip the photo record's status to ACTIVE — nothing surfaces the
   photo to other users until this pipeline completes.
```

## 3. Access Control

- Bucket is **private** — no object is ever publicly readable by a guessable/predictable URL, per Phase 1 §64's explicit requirement.
- Every read goes through `GET /api/v1/photos/:id` on our API, which runs the same field-visibility resolution as any other profile field (Phase 1 §9.3) before issuing a short-lived (5-minute) signed R2 GET URL — a viewer who isn't allowed to see the photo gets a 403 before a URL is ever generated, not a URL that happens to still work.
- Original uploads and generated thumbnails are stored as separate objects (`photos/{id}/original.jpg`, `photos/{id}/thumb.jpg`); list views request only the thumbnail.

## 4. Malware/Validation Checks

- MIME-type sniffing on the actual bytes (not just the client-declared `Content-Type` header) before the background pipeline trusts the file.
- A ClamAV-based scan step (or a hosted scanning API if running ClamAV isn't practical on this hosting tier — flagged as a concrete infra decision for M0) gates the ACTIVE flip in step 6 above; a failed scan deletes the object and notifies the uploader.

## 5. What's Explicitly Not Stored As a File

Receipts and invoices are generated as PDFs on demand from `financial_ledger`/`fee_invoices` data (not pre-rendered and stored) for the same reason financial history is never edited in place — the generator always reflects the current source-of-truth record, so there's no "stale PDF" to keep in sync.
