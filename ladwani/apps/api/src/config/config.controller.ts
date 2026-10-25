import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ConfigService } from './config.service'
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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { Audited } from '../common/decorators/audited.decorator'

@Controller('config')
@UseGuards(JwtAuthGuard)
export class ConfigController {
  constructor(private config: ConfigService) {}

  @Get('post-types')
  async listPostTypes() {
    return { data: await this.config.listPostTypes() }
  }

  @Post('post-types')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.post_type.create')
  async createPostType(@Body() dto: CreatePostTypeDto) {
    return { data: await this.config.createPostType(dto) }
  }

  @Patch('post-types/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.post_type.update')
  async updatePostType(@Param('id') id: string, @Body() dto: UpdatePostTypeDto) {
    return { data: await this.config.updatePostType(id, dto) }
  }

  @Get('asset-categories')
  async listAssetCategories() {
    return { data: await this.config.listAssetCategories() }
  }

  @Post('asset-categories')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.asset_category.create')
  async createAssetCategory(@Body() dto: CreateAssetCategoryDto) {
    return { data: await this.config.createAssetCategory(dto) }
  }

  @Patch('asset-categories/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.asset_category.update')
  async updateAssetCategory(@Param('id') id: string, @Body() dto: UpdateAssetCategoryDto) {
    return { data: await this.config.updateAssetCategory(id, dto) }
  }

  @Get('areas')
  async listAreas() {
    return { data: await this.config.listAreas() }
  }

  @Post('areas')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.area.create')
  async createArea(@Body() dto: CreateAreaDto) {
    return { data: await this.config.createArea(dto) }
  }

  @Patch('areas/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.area.update')
  async updateArea(@Param('id') id: string, @Body() dto: UpdateAreaDto) {
    return { data: await this.config.updateArea(id, dto) }
  }

  @Get('education-levels')
  async listEducationLevels() {
    return { data: await this.config.listEducationLevels() }
  }

  @Post('education-levels')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.education_level.create')
  async createEducationLevel(@Body() dto: CreateEducationLevelDto) {
    return { data: await this.config.createEducationLevel(dto) }
  }

  @Patch('education-levels/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.education_level.update')
  async updateEducationLevel(@Param('id') id: string, @Body() dto: UpdateEducationLevelDto) {
    return { data: await this.config.updateEducationLevel(id, dto) }
  }

  @Get('occupations')
  async listOccupations() {
    return { data: await this.config.listOccupations() }
  }

  @Post('occupations')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.occupation.create')
  async createOccupation(@Body() dto: CreateOccupationDto) {
    return { data: await this.config.createOccupation(dto) }
  }

  @Patch('occupations/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.occupation.update')
  async updateOccupation(@Param('id') id: string, @Body() dto: UpdateOccupationDto) {
    return { data: await this.config.updateOccupation(id, dto) }
  }

  @Get('skills')
  async listSkills() {
    return { data: await this.config.listSkills() }
  }

  @Post('skills')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.skill.create')
  async createSkill(@Body() dto: CreateSkillDto) {
    return { data: await this.config.createSkill(dto) }
  }

  @Patch('skills/:id')
  @UseGuards(PermissionsGuard)
  @Permissions('config:manage')
  @Audited('config.skill.update')
  async updateSkill(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return { data: await this.config.updateSkill(id, dto) }
  }
}
