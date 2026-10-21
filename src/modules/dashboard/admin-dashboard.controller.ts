import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { AdminDashboardResponse } from './dto/admin-dashboard.dto';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  @Cached({ namespace: 'dashboard:admin', ttl: 60 })
  getDashboard(): Promise<AdminDashboardResponse> {
    return this.adminDashboardService.getDashboard();
  }
}
