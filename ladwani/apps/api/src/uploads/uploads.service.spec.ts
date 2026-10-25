import { Test } from '@nestjs/testing'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { UploadsService } from './uploads.service'
import { PrismaService } from '../prisma/prisma.service'
import { FILE_STORAGE } from './file-storage.interface'
import { MALWARE_SCANNER } from './malware-scanner.interface'
import { DevFileStorageService } from './dev-file-storage.service'

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

describe('UploadsService', () => {
  let service: UploadsService
  let prisma: { uploadedFile: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock } }
  let storage: { code: string; getUploadUrl: jest.Mock; getDownloadUrl: jest.Mock }
  let devStorage: { writeBytes: jest.Mock }
  let scanner: { scan: jest.Mock }

  beforeEach(async () => {
    prisma = { uploadedFile: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() } }
    storage = { code: 'DEV', getUploadUrl: jest.fn().mockResolvedValue({ url: '/dev-put/key' }), getDownloadUrl: jest.fn().mockResolvedValue('/dev-get/key') }
    devStorage = { writeBytes: jest.fn() }
    scanner = { scan: jest.fn().mockResolvedValue({ clean: true }) }

    const moduleRef = await Test.createTestingModule({
      providers: [
        UploadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FILE_STORAGE, useValue: storage },
        { provide: MALWARE_SCANNER, useValue: scanner },
        { provide: DevFileStorageService, useValue: devStorage },
      ],
    }).compile()
    service = moduleRef.get(UploadsService)
  })

  describe('presign', () => {
    it('refuses a content type not on the purpose allowlist', async () => {
      await expect(service.presign('user-1', { purpose: 'PROFILE_PHOTO', contentType: 'application/pdf' })).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.uploadedFile.create).not.toHaveBeenCalled()
    })

    it('creates a PENDING record and returns the storage upload URL', async () => {
      prisma.uploadedFile.create.mockResolvedValue({ id: 'file-1' })
      const result = await service.presign('user-1', { purpose: 'PROFILE_PHOTO', contentType: 'image/jpeg' })
      expect(result).toEqual(expect.objectContaining({ id: 'file-1', uploadUrl: '/dev-put/key' }))
      expect(prisma.uploadedFile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ uploaderId: 'user-1', status: 'PENDING' }) }))
    })
  })

  describe('receiveBytes', () => {
    function pending(overrides: Partial<{ uploaderId: string; status: string; purpose: string }> = {}) {
      prisma.uploadedFile.findUnique.mockResolvedValue({ id: 'file-1', uploaderId: 'user-1', status: 'PENDING', purpose: 'PROFILE_PHOTO', ...overrides })
    }

    it('throws if no upload was presigned for that key', async () => {
      prisma.uploadedFile.findUnique.mockResolvedValue(null)
      await expect(service.receiveBytes('user-1', 'missing-key', JPEG_BYTES)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses bytes from someone other than the presigning user', async () => {
      pending({ uploaderId: 'someone-else' })
      await expect(service.receiveBytes('user-1', 'key', JPEG_BYTES)).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('refuses to re-finalize an upload that already resolved', async () => {
      pending({ status: 'ACTIVE' })
      await expect(service.receiveBytes('user-1', 'key', JPEG_BYTES)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a file over the purpose size ceiling without writing it to storage', async () => {
      pending()
      const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(6 * 1024 * 1024)])
      const result = await service.receiveBytes('user-1', 'key', oversized)
      expect(result.status).toBe('REJECTED')
      expect(devStorage.writeBytes).not.toHaveBeenCalled()
      expect(prisma.uploadedFile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }))
    })

    it('rejects a file whose real bytes are not an allowed type, even with a valid-looking presign', async () => {
      pending()
      const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00])
      const result = await service.receiveBytes('user-1', 'key', exeBytes)
      expect(result.status).toBe('REJECTED')
      expect(devStorage.writeBytes).not.toHaveBeenCalled()
    })

    it('rejects a file that fails the malware scan, even if it sniffs as an allowed type', async () => {
      pending()
      scanner.scan.mockResolvedValue({ clean: false, reason: 'looks like an executable' })
      const result = await service.receiveBytes('user-1', 'key', JPEG_BYTES)
      expect(result).toEqual({ status: 'REJECTED', reason: 'looks like an executable' })
      expect(devStorage.writeBytes).not.toHaveBeenCalled()
    })

    it('activates the file once size, type, and scan all pass', async () => {
      pending()
      const result = await service.receiveBytes('user-1', 'key', JPEG_BYTES)
      expect(result.status).toBe('ACTIVE')
      expect(devStorage.writeBytes).toHaveBeenCalledWith('key', JPEG_BYTES)
      expect(prisma.uploadedFile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', mimeType: 'image/jpeg', sizeBytes: JPEG_BYTES.length }) }),
      )
    })
  })

  describe('getDownloadUrl', () => {
    it('refuses access to a file the caller did not upload', async () => {
      prisma.uploadedFile.findUnique.mockResolvedValue({ id: 'file-1', uploaderId: 'someone-else', status: 'ACTIVE', storageKey: 'key' })
      await expect(service.getDownloadUrl('user-1', 'file-1')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('404s a file that never finished activating', async () => {
      prisma.uploadedFile.findUnique.mockResolvedValue({ id: 'file-1', uploaderId: 'user-1', status: 'PENDING', storageKey: 'key' })
      await expect(service.getDownloadUrl('user-1', 'file-1')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('returns a signed URL for the owner of an active file', async () => {
      prisma.uploadedFile.findUnique.mockResolvedValue({ id: 'file-1', uploaderId: 'user-1', status: 'ACTIVE', storageKey: 'key' })
      const result = await service.getDownloadUrl('user-1', 'file-1')
      expect(result).toEqual({ url: '/dev-get/key' })
    })
  })
})
