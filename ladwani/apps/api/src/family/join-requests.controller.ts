import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FamilyService } from './family.service'
import { RespondJoinRequestDto } from './dto/respond-join-request.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('join-requests')
@UseGuards(JwtAuthGuard)
export class JoinRequestsController {
  constructor(private families: FamilyService) {}

  @Post(':id/respond')
  @Audited('family.join_request.respond')
  async respond(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RespondJoinRequestDto) {
    return { data: await this.families.respondToJoinRequest(id, user.sub, dto.decision) }
  }
}
