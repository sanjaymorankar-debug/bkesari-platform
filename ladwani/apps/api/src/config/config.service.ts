import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePostTypeDto } from './dto/create-post-type.dto'
import { UpdatePostTypeDto } from './dto/update-post-type.dto'
import { CreateAssetCategoryDto } from './dto/create-asset-category.dto'
import { UpdateAssetCategoryDto } from './dto/update-asset-category.dto'
import { CreateAreaDto } from './dto/create-area.dto'
import { UpdateAreaDto } from './dto/update-area.dto'
import { CreateEducationLevelDto } from './dto/create-education-level.dto'
import { UpdateEducationLevelDto } from './dto/update-education-level.dto'
import { CreateOccupationDto } from './dto/create-occupation.dto'
import { UpdateOccupationDto } from './dto/update-occupation.dto'
import { CreateSkillDto } from './dto/create-skill.dto'
import { UpdateSkillDto } from './dto/update-skill.dto'

/**
 * Admin CRUD for the `[Cfg]` lookup catalogs seeded as starter data in M0–M4
 * (docs/02-feature-map.md) — post types, asset categories, and the area
 * tree. Mutations are permission-gated in the controller; reads are open to
 * any authenticated user since these are option lists other forms depend on.
 */
@Injectable()
export class ConfigService {
  constructor(private prisma: PrismaService) {}

  listPostTypes() {
    return this.prisma.postType.findMany({ orderBy: { label: 'asc' } })
  }

  createPostType(dto: CreatePostTypeDto) {
    return this.prisma.postType.create({ data: dto })
  }

  async updatePostType(id: string, dto: UpdatePostTypeDto) {
    await this.assertPostTypeExists(id)
    return this.prisma.postType.update({ where: { id }, data: dto })
  }

  listAssetCategories() {
    return this.prisma.assetCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
  }

  createAssetCategory(dto: CreateAssetCategoryDto) {
    return this.prisma.assetCategory.create({ data: dto })
  }

  async updateAssetCategory(id: string, dto: UpdateAssetCategoryDto) {
    await this.assertAssetCategoryExists(id)
    return this.prisma.assetCategory.update({ where: { id }, data: dto })
  }

  listAreas() {
    return this.prisma.area.findMany({ orderBy: { name: 'asc' } })
  }

  async createArea(dto: CreateAreaDto) {
    const community = await this.prisma.community.findFirst()
    if (!community) throw new NotFoundException('No community configured.')
    return this.prisma.area.create({ data: { name: dto.name, type: dto.type, parentId: dto.parentId, communityId: community.id } })
  }

  async updateArea(id: string, dto: UpdateAreaDto) {
    await this.assertAreaExists(id)
    return this.prisma.area.update({ where: { id }, data: dto })
  }

  listEducationLevels() {
    return this.prisma.educationLevel.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
  }

  createEducationLevel(dto: CreateEducationLevelDto) {
    return this.prisma.educationLevel.create({ data: dto })
  }

  async updateEducationLevel(id: string, dto: UpdateEducationLevelDto) {
    const found = await this.prisma.educationLevel.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Education level not found.')
    return this.prisma.educationLevel.update({ where: { id }, data: dto })
  }

  listOccupations() {
    return this.prisma.occupation.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] })
  }

  createOccupation(dto: CreateOccupationDto) {
    return this.prisma.occupation.create({ data: dto })
  }

  async updateOccupation(id: string, dto: UpdateOccupationDto) {
    const found = await this.prisma.occupation.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Occupation not found.')
    return this.prisma.occupation.update({ where: { id }, data: dto })
  }

  listSkills() {
    return this.prisma.skill.findMany({ orderBy: { label: 'asc' } })
  }

  createSkill(dto: CreateSkillDto) {
    return this.prisma.skill.create({ data: dto })
  }

  async updateSkill(id: string, dto: UpdateSkillDto) {
    const found = await this.prisma.skill.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Skill not found.')
    return this.prisma.skill.update({ where: { id }, data: dto })
  }

  private async assertPostTypeExists(id: string): Promise<void> {
    const found = await this.prisma.postType.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Post type not found.')
  }

  private async assertAssetCategoryExists(id: string): Promise<void> {
    const found = await this.prisma.assetCategory.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Asset category not found.')
  }

  private async assertAreaExists(id: string): Promise<void> {
    const found = await this.prisma.area.findUnique({ where: { id } })
    if (!found) throw new NotFoundException('Area not found.')
  }
}
