import { IsBase64, IsString } from 'class-validator'

/**
 * Dev-mode transport only — the real flow (docs/18 §2 step 4) has the
 * client PUT raw bytes directly to R2, never through this API at all, so
 * there is no production body-parsing concern this shortcut could affect.
 * Base64-in-JSON keeps the dev shim on the app's one already-configured
 * JSON body parser instead of adding route-scoped raw-body middleware for
 * a code path real deployments never exercise.
 */
export class DevPutDto {
  @IsString()
  @IsBase64()
  dataBase64!: string
}
