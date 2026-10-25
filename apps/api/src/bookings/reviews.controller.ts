import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ReviewsService } from './reviews.service'
import { CreateReviewDto } from './dto/create-review.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('reviews')
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @Audited('review.create')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateReviewDto) {
    return { data: await this.reviews.createReview(user.sub, dto) }
  }

  @Get('asset/:assetId')
  async listForAsset(@Param('assetId') assetId: string) {
    return { data: await this.reviews.listForAsset(assetId) }
  }
}
