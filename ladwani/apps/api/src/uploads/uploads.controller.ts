import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { UploadsService } from './uploads.service'
import { PresignUploadDto } from './dto/presign-upload.dto'
import { DevPutDto } from './dto/dev-put.dto'
import { DevFileStorageService } from './dev-file-storage.service'
import { FILE_STORAGE, type FileStorage } from './file-storage.interface'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('uploads')
export class UploadsController {
  constructor(
    private uploads: UploadsService,
    private devStorage: DevFileStorageService,
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
  ) {}

  @Post('presign')
  @UseGuards(JwtAuthGuard)
  async presign(@CurrentUser() user: JwtPayload, @Body() dto: PresignUploadDto) {
    return { data: await this.uploads.presign(user.sub, dto) }
  }

  /** Dev-mode stand-in for a direct-to-R2 PUT — see DevPutDto for why this is base64 JSON, not a raw body. */
  @Post('dev-put/:key')
  @UseGuards(JwtAuthGuard)
  async devPut(@CurrentUser() user: JwtPayload, @Param('key') key: string, @Body() dto: DevPutDto) {
    if (this.storage.code !== 'DEV') throw new BadRequestException('The dev-put endpoint is only available when the DEV storage provider is active.')
    return { data: await this.uploads.receiveBytes(user.sub, key, Buffer.from(dto.dataBase64, 'base64')) }
  }

  /** Unauthenticated by design — access is controlled by the signature+expiry, matching a real presigned URL. */
  @Get('dev-get/:key')
  async devGet(@Param('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (this.storage.code !== 'DEV') throw new BadRequestException('The dev-get endpoint is only available when the DEV storage provider is active.')
    if (!this.devStorage.verifyDownloadSignature(key, Number(exp), sig)) throw new BadRequestException('Invalid or expired download link.')

    const record = await this.prisma.uploadedFile.findUnique({ where: { storageKey: key } })
    if (!record || record.status !== 'ACTIVE') throw new NotFoundException('File not found.')

    const bytes = await this.devStorage.readBytes(key)
    res.setHeader('Content-Type', record.mimeType ?? 'application/octet-stream')
    res.send(bytes)
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getDownloadUrl(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return { data: await this.uploads.getDownloadUrl(user.sub, id) }
  }
}
