import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached, InvalidateCache } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import {
  RISK_CACHE_NAMESPACE,
  RISK_CACHE_TTL_SECONDS,
} from './constants/risk.constants';
import { RiskLearnerQueryDto } from './dto/risk.dto';
import { RiskService } from './risk.service';

@Controller('risk')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Get('model')
  @Roles(UserRole.ADMIN)
  getModel() {
    return this.riskService.getModel();
  }

  @Post('model/train')
  @Roles(UserRole.ADMIN)
  trainModel() {
    return this.riskService.trainModel();
  }

  @Get('courses/:courseId/summary')
  @Roles(UserRole.INSTRUCTOR)
  @Cached({
    namespace: RISK_CACHE_NAMESPACE,
    ttl: RISK_CACHE_TTL_SECONDS,
    scope: 'user',
  })
  getSummary(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.riskService.getSummary(courseId, instructorId);
  }

  @Get('courses/:courseId/learners')
  @Roles(UserRole.INSTRUCTOR)
  @Cached({
    namespace: RISK_CACHE_NAMESPACE,
    ttl: RISK_CACHE_TTL_SECONDS,
    scope: 'user',
  })
  getLearners(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
    @Query() query: RiskLearnerQueryDto,
  ) {
    return this.riskService.getLearners(courseId, instructorId, query);
  }

  @Get('courses/:courseId/learners/:learnerId')
  @Roles(UserRole.INSTRUCTOR)
  @Cached({
    namespace: RISK_CACHE_NAMESPACE,
    ttl: RISK_CACHE_TTL_SECONDS,
    scope: 'user',
  })
  getLearnerDetail(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('learnerId', ParseUUIDPipe) learnerId: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.riskService.getLearnerDetail(courseId, learnerId, instructorId);
  }

  @Post('courses/:courseId/recompute')
  @Roles(UserRole.INSTRUCTOR)
  @InvalidateCache([RISK_CACHE_NAMESPACE])
  recomputeCourse(
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.riskService.recomputeCourse(courseId, instructorId);
  }
}
