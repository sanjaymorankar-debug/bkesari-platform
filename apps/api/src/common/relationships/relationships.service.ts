import { Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export interface LinkMembersInput {
  fromMemberId: string
  toMemberId: string
  relationshipTypeCode: string
  familyId?: string
  createdBy?: string
}

/**
 * Writes both directions of a relationship in one call, per the relationship
 * type's configured inverse (docs/06-database-schema.md §B, J2 step 3).
 * A relationship type with no configured inverse (none currently seeded) is
 * written one-directionally only.
 */
@Injectable()
export class RelationshipsService {
  async linkMembers(tx: Tx, input: LinkMembersInput): Promise<void> {
    const relType = await tx.relationshipType.findUnique({ where: { code: input.relationshipTypeCode } })
    if (!relType) throw new NotFoundException(`Unknown relationship type "${input.relationshipTypeCode}"`)

    await this.writeOneDirection(tx, input.fromMemberId, input.toMemberId, relType.id, input.familyId, input.createdBy)

    if (relType.inverseCode) {
      const inverseType = await tx.relationshipType.findUnique({ where: { code: relType.inverseCode } })
      if (inverseType) {
        await this.writeOneDirection(tx, input.toMemberId, input.fromMemberId, inverseType.id, input.familyId, input.createdBy)
      }
    }
  }

  private async writeOneDirection(
    db: Tx,
    fromMemberId: string,
    toMemberId: string,
    relationshipTypeId: string,
    familyId?: string,
    createdBy?: string,
  ) {
    await db.memberRelationship.upsert({
      where: { fromMemberId_toMemberId_relationshipTypeId: { fromMemberId, toMemberId, relationshipTypeId } },
      update: { isActive: true },
      create: { fromMemberId, toMemberId, relationshipTypeId, familyId, createdBy },
    })
  }
}
