import { Test } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'
import { ConfigService } from './config.service'
import { PrismaService } from '../prisma/prisma.service'

describe('ConfigService', () => {
  let service: ConfigService
  let prisma: {
    postType: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    assetCategory: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    area: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    community: { findFirst: jest.Mock }
    educationLevel: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    occupation: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    skill: { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
  }

  beforeEach(async () => {
    prisma = {
      postType: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      assetCategory: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      area: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      community: { findFirst: jest.fn() },
      educationLevel: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      occupation: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      skill: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    }
    const moduleRef = await Test.createTestingModule({
      providers: [ConfigService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(ConfigService)
  })

  describe('post types', () => {
    it('creates a new post type from admin input', async () => {
      prisma.postType.create.mockResolvedValue({ id: 'pt-1', code: 'JOB', label: 'Job Posting' })
      const result = await service.createPostType({ code: 'JOB', label: 'Job Posting' })
      expect(result.code).toBe('JOB')
      expect(prisma.postType.create).toHaveBeenCalledWith({ data: { code: 'JOB', label: 'Job Posting' } })
    })

    it('refuses to update a post type that does not exist', async () => {
      prisma.postType.findUnique.mockResolvedValue(null)
      await expect(service.updatePostType('missing', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.postType.update).not.toHaveBeenCalled()
    })

    it('can deactivate an existing post type', async () => {
      prisma.postType.findUnique.mockResolvedValue({ id: 'pt-1' })
      prisma.postType.update.mockResolvedValue({ id: 'pt-1', isActive: false })
      const result = await service.updatePostType('pt-1', { isActive: false })
      expect(result.isActive).toBe(false)
    })
  })

  describe('asset categories', () => {
    it('creates a new asset category', async () => {
      prisma.assetCategory.create.mockResolvedValue({ id: 'ac-1', code: 'FARM_HOUSE', label: 'Farm House' })
      await service.createAssetCategory({ code: 'FARM_HOUSE', label: 'Farm House' })
      expect(prisma.assetCategory.create).toHaveBeenCalled()
    })

    it('refuses to update an asset category that does not exist', async () => {
      prisma.assetCategory.findUnique.mockResolvedValue(null)
      await expect(service.updateAssetCategory('missing', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('areas', () => {
    it('creates an area under the single seeded community', async () => {
      prisma.community.findFirst.mockResolvedValue({ id: 'community-1' })
      prisma.area.create.mockResolvedValue({ id: 'area-1', name: 'Pune', type: 'CITY' })
      await service.createArea({ name: 'Pune', type: 'CITY' })
      expect(prisma.area.create).toHaveBeenCalledWith({ data: { name: 'Pune', type: 'CITY', parentId: undefined, communityId: 'community-1' } })
    })

    it('refuses to create an area when no community is configured', async () => {
      prisma.community.findFirst.mockResolvedValue(null)
      await expect(service.createArea({ name: 'Pune', type: 'CITY' })).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses to update an area that does not exist', async () => {
      prisma.area.findUnique.mockResolvedValue(null)
      await expect(service.updateArea('missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('education levels', () => {
    it('creates a new education level', async () => {
      prisma.educationLevel.create.mockResolvedValue({ id: 'el-1', code: 'PHD', label: 'Doctorate' })
      await service.createEducationLevel({ code: 'PHD', label: 'Doctorate' })
      expect(prisma.educationLevel.create).toHaveBeenCalled()
    })

    it('refuses to update an education level that does not exist', async () => {
      prisma.educationLevel.findUnique.mockResolvedValue(null)
      await expect(service.updateEducationLevel('missing', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('occupations', () => {
    it('creates a new occupation', async () => {
      prisma.occupation.create.mockResolvedValue({ id: 'occ-1', code: 'ENGINEER', label: 'Engineer' })
      await service.createOccupation({ code: 'ENGINEER', label: 'Engineer' })
      expect(prisma.occupation.create).toHaveBeenCalled()
    })

    it('refuses to update an occupation that does not exist', async () => {
      prisma.occupation.findUnique.mockResolvedValue(null)
      await expect(service.updateOccupation('missing', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('skills', () => {
    it('creates a new skill', async () => {
      prisma.skill.create.mockResolvedValue({ id: 'sk-1', code: 'COOKING', label: 'Cooking' })
      await service.createSkill({ code: 'COOKING', label: 'Cooking' })
      expect(prisma.skill.create).toHaveBeenCalled()
    })

    it('refuses to update a skill that does not exist', async () => {
      prisma.skill.findUnique.mockResolvedValue(null)
      await expect(service.updateSkill('missing', { label: 'x' })).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
