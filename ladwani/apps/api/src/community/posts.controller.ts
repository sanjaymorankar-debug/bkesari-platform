import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { CommunityService } from './community.service'
import { CreatePostDto } from './dto/create-post.dto'
import { CreateCommentDto } from './dto/create-comment.dto'
import { ReactDto } from './dto/react.dto'
import { CreateReportDto } from './dto/create-report.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import { ViewerContextService } from '../common/privacy/viewer-context.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(
    private community: CommunityService,
    private viewerContext: ViewerContextService,
  ) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('post:create')
  @Audited('community.post.create')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePostDto) {
    return { data: await this.community.createPost(user.sub, dto) }
  }

  @Get()
  async feed(@CurrentUser() user: JwtPayload, @Query('postType') postType?: string) {
    const viewer = await this.viewerContext.build(user.sub)
    return { data: await this.community.getFeed(viewer.areaIds ?? [], { postTypeCode: postType }) }
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return { data: await this.community.getPost(id) }
  }

  @Post(':id/comments')
  @Audited('community.comment.create')
  async addComment(@Param('id') postId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateCommentDto) {
    return { data: await this.community.addComment(user.sub, postId, dto) }
  }

  @Post(':id/react')
  async react(@Param('id') postId: string, @CurrentUser() user: JwtPayload, @Body() dto: ReactDto) {
    return { data: await this.community.react(user.sub, { postId }, dto.type) }
  }

  @Delete(':id/react')
  async removeReaction(@Param('id') postId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.community.removeReaction(user.sub, { postId }) }
  }

  @Post(':id/report')
  @Audited('community.post.report')
  async report(@Param('id') postId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateReportDto) {
    return { data: await this.community.createReport(user.sub, { postId }, dto.reason) }
  }
}
