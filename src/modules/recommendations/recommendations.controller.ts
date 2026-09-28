import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PublicCourseResponse } from '../courses/dto/course.dto';
import { UserRole } from '../users/entities/user.entity';
import { RecommendationLimitQueryDto } from './dto/recommendation.dto';
import { RecommendationsService } from './recommendations.service';
import type { AuthenticatedUser } from '../auth/dto/auth.dto';

@Controller('recommendations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('me')
  getMyRecommendations(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: RecommendationLimitQueryDto,
  ): Promise<PublicCourseResponse[]> {
    return this.recommendationsService.getRecommendations(user.id, query.limit);
  }
}
