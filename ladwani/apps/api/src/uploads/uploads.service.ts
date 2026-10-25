import { randomBytes } from 'crypto'
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { UploadPurpose } from '@community-platform/shared-types'
import { PrismaService } from '../prisma/prisma.service'
import { FILE_STORAGE, type FileStorage } from './file-storage.interface'
import { MALWARE_SCANNER, type MalwareScanner } from './malware-scanner.interface'
import { DevFileStorageService } from './dev-file-storage.service'
import { sniffFileType } from './file-sniffer'
import { PresignUploadDto } from './dto/presign-upload.dto'

interface PurposeRule {
  maxSizeBytes: number
  allowedMimeTypes: string[]
}

const PURPOSE_RULES: Record<UploadPurpose, PurposeRule> = {
  PROFILE_PHOTO: { maxSizeBytes: 5 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  ASSET_PHOTO: { maxSizeBytes: 5 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  DOCUMENT: { maxSizeBytes: 10 * 1024 * 1024, allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] },
}

/**
 * Orchestrates the presign → upload-bytes → validate → activate flow from
 * docs/18-file-storage-design.md, run synchronously rather than via the
 * doc's background job (this codebase has no scheduler/queue anywhere else
 * either — booking expiry, late fees, and reconciliation are all computed
 * the same way). Real Cloudflare R2 storage and a real ClamAV/hosted scan
 * API are the infra/credential gaps, swappable via FILE_STORAGE_PROVIDER
 * and MALWARE_SCANNER_PROVIDER — same pattern as M4's payment gateway.
 */
@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    @Inject(MALWARE_SCANNER) private scanner: MalwareScanner,
    // Dev-only transport concern (see receiveBytes) — a real R2 flow never routes bytes
    // through this API at all, so writing them to disk isn't part of the FileStorage
    // interface real providers implement; injected concretely, same as M4's DevGatewayService.
    private devStorage: DevFileStorageService,
  ) {}

  async presign(userId: string, dto: PresignUploadDto) {
    const rule = PURPOSE_RULES[dto.purpose]
    if (!rule.allowedMimeTypes.includes(dto.contentType)) {
      throw new BadRequestException(`${dto.purpose} only accepts: ${rule.allowedMimeTypes.join(', ')}.`)
    }

    const key = `${dto.purpose}/${userId}/${randomBytes(16).toString('hex')}`
    const record = await this.prisma.uploadedFile.create({
      data: { uploaderId: userId, purpose: dto.purpose, storageProvider: this.storage.code, storageKey: key, mimeType: dto.contentType, status: 'PENDING' },
    })

    const { url } = await this.storage.getUploadUrl(key, dto.contentType)
    return { id: record.id, uploadUrl: url, key, maxSizeBytes: rule.maxSizeBytes }
  }

  /** Handles the PUT of raw bytes to a presigned (or dev-mode stand-in) upload URL. */
  async receiveBytes(userId: string, key: string, buffer: Buffer): Promise<{ status: string; reason?: string }> {
    const record = await this.prisma.uploadedFile.findUnique({ where: { storageKey: key } })
    if (!record) throw new NotFoundException('No upload was presigned for this key.')
    if (record.uploaderId !== userId) throw new ForbiddenException('This upload does not belong to you.')
    if (record.status !== 'PENDING') throw new BadRequestException('This upload has already been finalized.')

    const rule = PURPOSE_RULES[record.purpose as UploadPurpose]
    if (buffer.length === 0) return this.reject(record.id, 'Empty file.')
    if (buffer.length > rule.maxSizeBytes) return this.reject(record.id, `File exceeds the ${rule.maxSizeBytes} byte limit for ${record.purpose}.`)

    const sniffed = sniffFileType(buffer)
    if (!sniffed || !rule.allowedMimeTypes.includes(sniffed.mimeType)) {
      return this.reject(record.id, 'File content does not match an allowed type for this purpose.')
    }

    const scanResult = await this.scanner.scan(buffer)
    if (!scanResult.clean) return this.reject(record.id, scanResult.reason ?? 'Failed malware scan.')

    await this.devStorage.writeBytes(key, buffer)
    await this.prisma.uploadedFile.update({
      where: { id: record.id },
      data: { status: 'ACTIVE', mimeType: sniffed.mimeType, sizeBytes: buffer.length, activatedAt: new Date() },
    })
    return { status: 'ACTIVE' }
  }

  /**
   * No visibility engine is wired in here — this generic pipeline only
   * enforces "the uploader can always read their own file." A feature that
   * adopts this for shareable content (e.g. asset photos) is responsible
   * for its own visibility check before calling this.
   */
  async getDownloadUrl(userId: string, id: string): Promise<{ url: string }> {
    const record = await this.prisma.uploadedFile.findUnique({ where: { id } })
    if (!record || record.status !== 'ACTIVE') throw new NotFoundException('File not found.')
    if (record.uploaderId !== userId) throw new ForbiddenException('You do not have access to this file.')

    const url = await this.storage.getDownloadUrl(record.storageKey, 300)
    return { url }
  }

  /**
   * For a feature that already ran its own visibility check (e.g. matrimony's
   * canViewMatrimonyProfile) and just needs the URL for a file it knows the id
   * of — never exposed directly as a controller route, only called from another
   * service after that service has decided the viewer is allowed to see this
   * specific file. Returns null rather than throwing so callers can degrade
   * gracefully (e.g. omit the photo) instead of failing the whole response.
   */
  async getSignedUrlForAuthorizedViewer(fileId: string | null | undefined): Promise<string | null> {
    if (!fileId) return null
    const record = await this.prisma.uploadedFile.findUnique({ where: { id: fileId } })
    if (!record || record.status !== 'ACTIVE') return null
    return this.storage.getDownloadUrl(record.storageKey, 300)
  }

  private async reject(id: string, reason: string): Promise<{ status: string; reason: string }> {
    await this.prisma.uploadedFile.update({ where: { id }, data: { status: 'REJECTED', rejectionReason: reason } })
    return { status: 'REJECTED', reason }
  }
}
