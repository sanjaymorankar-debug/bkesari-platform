import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { trustProxySetting } from './common/trust-proxy'
import { env } from './common/env'

/**
 * The configured API, initialised but not listening. scripts/hostinger-start.js
 * serves it from the web app's own process, where a second listen() is not allowed.
 */
export async function createApi(): Promise<NestExpressApplication> {
  // Fail fast rather than silently sign every session token with a secret checked into source
  // control — the dev fallback below (auth.module.ts, jwt.strategy.ts) exists only for local dev.
  if (process.env.NODE_ENV === 'production' && !env('JWT_SECRET')) {
    throw new Error('JWT_SECRET must be set in production — refusing to start with the dev default secret.')
  }

  // rawBody: true keeps req.rawBody available on every request (needed for webhook signature
  // verification, which must run over the exact bytes sent — docs/19 §3) without disabling the
  // global JSON parser for every other route.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  // Per-visitor rate limits behind a proxy -- see common/trust-proxy.ts.
  const trustProxy = trustProxySetting(env('TRUST_PROXY'))
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy)
  app.use(helmet())
  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableCors({ origin: env('WEB_ORIGIN') ?? 'http://localhost:3000', credentials: true })
  app.setGlobalPrefix('api/v1')
  return app
}

async function bootstrap() {
  const app = await createApi()
  const port = process.env.API_PORT ?? process.env.PORT ?? 4000
  if (process.env.API_PORT) await app.listen(port, '127.0.0.1')
  else await app.listen(port)
}

// Not when loaded by scripts/hostinger-start.js, which calls createApi() itself.
if (require.main === module) bootstrap()
