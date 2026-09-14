import {
  Body,
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
import { User, UserRole } from '../users/entities/user.entity';
import {
  CancelWithdrawRequestDto,
  CreateWithdrawRequestDto,
  ListAdminWithdrawRequestsQueryDto,
  ListMyWithdrawRequestsQueryDto,
  RejectWithdrawRequestDto,
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

  @Post(':id/cancel')
  @Roles(UserRole.INSTRUCTOR)
  cancel(
    @CurrentUser() currentUser: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelWithdrawRequestDto,
  ) {
    return this.withdrawService.cancel(currentUser, id, dto);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectWithdrawRequestDto,
  ) {
    return this.withdrawService.reject(id, dto);
  }
}
