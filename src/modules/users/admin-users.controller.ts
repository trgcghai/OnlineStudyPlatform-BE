import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from './entities/user.entity';
import {
  CreateAdminUserDto,
  AdminListUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';
import { UsersService } from './users.service';

@Controller('users/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: AdminListUsersQueryDto) {
    return this.usersService.findAllForAdmin(query);
  }

  @Post()
  create(@Body() createDto: CreateAdminUserDto) {
    return this.usersService.createAsAdmin(createDto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateAdminUserDto,
  ) {
    return this.usersService.updateAsAdmin(id, updateDto);
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.OK)
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.disableUser(id);
  }

  @Get('instructors/:instructorId/account')
  getInstructorAccount(
    @Param('instructorId', ParseUUIDPipe) instructorId: string,
  ) {
    return this.usersService.getInstructorAccountForAdmin(instructorId);
  }
}
