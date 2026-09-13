import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';
import {
  CreateWithdrawRequestDto,
  ListAdminWithdrawRequestsQueryDto,
  ListMyWithdrawRequestsQueryDto,
} from './dto/withdraw.dto';
import { WithdrawService } from './withdraw.service';

@Controller('withdraw')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WithdrawController {
  constructor(private readonly withdrawService: WithdrawService) {}

  @Post()
  @Roles(UserRole.INSTRUCTOR)
  create(
    @CurrentUser() currentUser: User,
    @Body() dto: CreateWithdrawRequestDto,
  ) {
    return this.withdrawService.create(currentUser, dto);
  }

  @Get('me')
  @Roles(UserRole.INSTRUCTOR)
  listMine(
    @CurrentUser() currentUser: User,
    @Query() query: ListMyWithdrawRequestsQueryDto,
  ) {
    return this.withdrawService.listMine(currentUser, query);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  listAdmin(@Query() query: ListAdminWithdrawRequestsQueryDto) {
    return this.withdrawService.listAdmin(query);
  }
}
