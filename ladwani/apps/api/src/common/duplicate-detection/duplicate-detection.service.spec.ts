import { Test } from '@nestjs/testing'
import { DuplicateDetectionService } from './duplicate-detection.service'
import { PrismaService } from '../../prisma/prisma.service'

describe('DuplicateDetectionService', () => {
  let service: DuplicateDetectionService
  let prisma: { family: { findMany: jest.Mock }; member: { findMany: jest.Mock } }

  beforeEach(async () => {
    prisma = { family: { findMany: jest.fn() }, member: { findMany: jest.fn() } }
    const moduleRef = await Test.createTestingModule({
      providers: [DuplicateDetectionService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(DuplicateDetectionService)
  })

  describe('checkFamily', () => {
    it('triggers on a matching family name with the same native village', async () => {
      prisma.family.findMany.mockResolvedValue([
        { id: 'fam-1', name: 'Deshmukh Family', nativeVillage: 'Pune', nativeDistrict: null },
      ])

      const matches = await service.checkFamily({ name: 'Deshmukh Family', nativeVillage: 'Pune' })

      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({ id: 'fam-1', reason: expect.stringContaining('native place') })
    })

    it('does not trigger when there is no candidate with a matching name', async () => {
      prisma.family.findMany.mockResolvedValue([{ id: 'fam-2', name: 'Kulkarni Family', nativeVillage: 'Pune', nativeDistrict: null }])

      const matches = await service.checkFamily({ name: 'Deshmukh Family', nativeVillage: 'Pune' })

      expect(matches).toHaveLength(0)
    })

    it('is case- and punctuation-insensitive when comparing names', async () => {
      prisma.family.findMany.mockResolvedValue([{ id: 'fam-3', name: 'deshmukh-family', nativeVillage: null, nativeDistrict: null }])

      const matches = await service.checkFamily({ name: 'Deshmukh Family' })

      expect(matches).toHaveLength(1)
    })
  })

  describe('checkMember', () => {
    it('triggers on same normalized full name and date of birth', async () => {
      prisma.member.findMany.mockResolvedValue([
        { id: 'mem-1', firstName: 'Ravi', lastName: 'Deshmukh', dateOfBirth: new Date('1990-01-15'), nativeVillage: null },
      ])

      const matches = await service.checkMember({ firstName: 'Ravi', lastName: 'Deshmukh', dateOfBirth: new Date('1990-01-15') })

      expect(matches).toHaveLength(1)
      expect(matches[0].reason).toContain('date of birth')
    })

    it('does not trigger for a same-name member with a different date of birth and no shared native place', async () => {
      prisma.member.findMany.mockResolvedValue([
        { id: 'mem-2', firstName: 'Ravi', lastName: 'Deshmukh', dateOfBirth: new Date('1985-06-01'), nativeVillage: 'Nashik' },
      ])

      const matches = await service.checkMember({ firstName: 'Ravi', lastName: 'Deshmukh', dateOfBirth: new Date('1990-01-15'), nativeVillage: 'Pune' })

      expect(matches).toHaveLength(0)
    })
  })
})
