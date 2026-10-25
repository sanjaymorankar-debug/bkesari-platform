import { Module } from '@nestjs/common'
import { UploadsService } from './uploads.service'
import { UploadsController } from './uploads.controller'
import { DevFileStorageService } from './dev-file-storage.service'
import { DevMalwareScannerService } from './dev-malware-scanner.service'
import { FILE_STORAGE } from './file-storage.interface'
import { MALWARE_SCANNER } from './malware-scanner.interface'

@Module({
  providers: [
    UploadsService,
    DevFileStorageService,
    DevMalwareScannerService,
    // No real provider exists yet — swap in a Cloudflare R2 / ClamAV implementation here
    // the same way payment-gateway.module.ts switches on PAYMENT_GATEWAY_PROVIDER, once
    // those credentials exist.
    { provide: FILE_STORAGE, useExisting: DevFileStorageService },
    { provide: MALWARE_SCANNER, useExisting: DevMalwareScannerService },
  ],
  controllers: [UploadsController],
  exports: [UploadsService],
})
export class UploadsModule {}
