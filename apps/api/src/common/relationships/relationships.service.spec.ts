import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { RelationshipsService } from './relationships.service'

describe('RelationshipsService', () => {
  let service: RelationshipsService
  let tx: { relationshipType: { findUnique: jest.Mock }; memberRelationship: { upsert: jest.Mock } }

  beforeEach(async () => {
    tx = {
      relationshipType: { findUnique: jest.fn() },
      memberRelationship: { upsert: jest.fn() },
    }
    const moduleRef = await Test.createTestingModule({ providers: [RelationshipsService] }).compile()
    service = moduleRef.get(RelationshipsService)
  })

  it('writes both directions of a relationship using the configured inverse', async () => {
    tx.relationshipType.findUnique
      .mockResolvedValueOnce({ id: 'rt-son', code: 'son', inverseCode: 'father' })
      .mockResolvedValueOnce({ id: 'rt-father', code: 'father', inverseCode: 'son' })

    await service.linkMembers(tx as never, {
      fromMemberId: 'child-1',
      toMemberId: 'parent-1',
      relationshipTypeCode: 'son',
      familyId: 'fam-1',
      createdBy: 'user-1',
    })

    expect(tx.memberRelationship.upsert).toHaveBeenCalledTimes(2)
    expect(tx.memberRelationship.upsert).toHaveBeenNthCalledWith(1, {
      where: { fromMemberId_toMemberId_relationshipTypeId: { fromMemberId: 'child-1', toMemberId: 'parent-1', relationshipTypeId: 'rt-son' } },
      update: { isActive: true },
      create: { fromMemberId: 'child-1', toMemberId: 'parent-1', relationshipTypeId: 'rt-son', familyId: 'fam-1', createdBy: 'user-1' },
    })
    expect(tx.memberRelationship.upsert).toHaveBeenNthCalledWith(2, {
      where: { fromMemberId_toMemberId_relationshipTypeId: { fromMemberId: 'parent-1', toMemberId: 'child-1', relationshipTypeId: 'rt-father' } },
      update: { isActive: true },
      create: { fromMemberId: 'parent-1', toMemberId: 'child-1', relationshipTypeId: 'rt-father', familyId: 'fam-1', createdBy: 'user-1' },
    })
  })

  it('writes only one direction when the relationship type has no configured inverse', async () => {
    tx.relationshipType.findUnique.mockResolvedValueOnce({ id: 'rt-x', code: 'friend', inverseCode: null })

    await service.linkMembers(tx as never, { fromMemberId: 'a', toMemberId: 'b', relationshipTypeCode: 'friend' })

    expect(tx.memberRelationship.upsert).toHaveBeenCalledTimes(1)
  })

  it('rejects an unknown relationship type code', async () => {
    tx.relationshipType.findUnique.mockResolvedValueOnce(null)

    await expect(
      service.linkMembers(tx as never, { fromMemberId: 'a', toMemberId: 'b', relationshipTypeCode: 'nonexistent' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
