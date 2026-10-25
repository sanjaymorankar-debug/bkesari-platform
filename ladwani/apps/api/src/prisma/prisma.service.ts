import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { env } from '../common/env'

/**
 * Neon suspends an idle compute after five minutes and closes its connections.
 * Prisma hands each closed connection out once more, and that query fails with
 * P1017, so a sign-in after a quiet spell could fail. Retiring connections
 * idle for 30 s, well inside that window, avoids it; and a waking compute can
 * take longer than Prisma's default 5 s connect timeout. A value the URL
 * already sets wins.
 */
const CONNECTION_DEFAULTS: Record<string, string> = {
  max_idle_connection_lifetime: '30',
  connect_timeout: '15',
}

export function withConnectionDefaults(url: string | undefined): string | undefined {
  if (!url) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url // let Prisma report the malformed URL itself
  }
  for (const [key, value] of Object.entries(CONNECTION_DEFAULTS)) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value)
  }
  return parsed.toString()
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = withConnectionDefaults(env('DATABASE_URL'))
    super(url ? { datasources: { db: { url } } } : undefined)
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
