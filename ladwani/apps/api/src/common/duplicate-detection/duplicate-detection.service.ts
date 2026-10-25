import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

export interface DuplicateMatch {
  id: string
  reason: string
}

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Heuristic duplicate detection — docs/04-user-journeys.md J11. Never
 * auto-merges; only surfaces candidates for the submitter and, separately,
 * the Operator/Admin review queue to judge (§78).
 */
@Injectable()
export class DuplicateDetectionService {
  constructor(private prisma: PrismaService) {}

  async checkFamily(input: { name: string; nativeVillage?: string | null; nativeDistrict?: string | null }): Promise<DuplicateMatch[]> {
    const candidates = await this.prisma.family.findMany({
      where: { deletedAt: null, OR: [{ name: { contains: input.name, mode: 'insensitive' } }, ...(input.nativeVillage ? [{ nativeVillage: input.nativeVillage }] : [])] },
      select: { id: true, name: true, nativeVillage: true, nativeDistrict: true },
      take: 25,
    })

    const targetName = normalize(input.name)
    const matches: DuplicateMatch[] = []
    for (const c of candidates) {
      const sameName = normalize(c.name) === targetName
      const sameVillage = !!input.nativeVillage && normalize(c.nativeVillage) === normalize(input.nativeVillage)
      const sameDistrict = !!input.nativeDistrict && normalize(c.nativeDistrict) === normalize(input.nativeDistrict)
      if (sameName && (sameVillage || sameDistrict)) matches.push({ id: c.id, reason: 'Same family name and native place' })
      else if (sameName) matches.push({ id: c.id, reason: 'Same family name' })
    }
    return matches
  }

  async checkMember(input: {
    firstName: string
    lastName?: string | null
    dateOfBirth?: Date | null
    nativeVillage?: string | null
  }): Promise<DuplicateMatch[]> {
    const candidates = await this.prisma.member.findMany({
      where: { deletedAt: null, firstName: { contains: input.firstName, mode: 'insensitive' } },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true, nativeVillage: true },
      take: 25,
    })

    const targetFullName = normalize(`${input.firstName}${input.lastName ?? ''}`)
    const matches: DuplicateMatch[] = []
    for (const c of candidates) {
      const sameFullName = normalize(`${c.firstName}${c.lastName ?? ''}`) === targetFullName
      if (!sameFullName) continue

      const sameDob = !!input.dateOfBirth && c.dateOfBirth?.toDateString() === input.dateOfBirth.toDateString()
      const sameVillage = !!input.nativeVillage && normalize(c.nativeVillage) === normalize(input.nativeVillage)
      if (sameDob) matches.push({ id: c.id, reason: 'Same name and date of birth' })
      else if (sameVillage) matches.push({ id: c.id, reason: 'Same name and native place' })
    }
    return matches
  }
}
