import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { LearnerDashboardResponse } from './dto/learner-dashboard.dto';
import { LearnerDashboardService } from './learner-dashboard.service';

@Controller('learner/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.LEARNER)
export class DashboardController {
  constructor(
    private readonly learnerDashboardService: LearnerDashboardService,
  ) {}

  @Get()
  @Cached({ namespace: 'dashboard:learner', ttl: 30, scope: 'user' })
  getLearnerDashboard(
    @CurrentUser('id') learnerId: string,
  ): Promise<LearnerDashboardResponse> {
    return this.learnerDashboardService.getDashboard(learnerId);
  }
}
