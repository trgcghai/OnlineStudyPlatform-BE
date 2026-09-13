import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AvatarUploadExceptionFilter } from './filters/avatar-upload-exception.filter';
import { UpsertInstructorAccountDto } from './dto/instructor-account.dto';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
} from './dto/user.dto';
import { UsersService } from './users.service';
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_FIELD_NAME,
  AVATAR_MAX_SIZE_BYTES,
} from '../../common/constants/file.constant';
import { UserRole } from './entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @UseInterceptors(ClassSerializerInterceptor)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser('id') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @CurrentUser('id') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Get('me/instructor-account')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  getMyInstructorAccount(@CurrentUser('id') instructorId: string) {
    return this.usersService.getMyInstructorAccount(instructorId);
  }

  @Put('me/instructor-account')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.INSTRUCTOR)
  upsertMyInstructorAccount(
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpsertInstructorAccountDto,
  ) {
    return this.usersService.upsertMyInstructorAccount(instructorId, dto);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.usersService.changePassword(userId, changePasswordDto);

    return { passwordChanged: true };
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @UseFilters(AvatarUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor(AVATAR_FIELD_NAME, {
      limits: { fileSize: AVATAR_MAX_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!AVATAR_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              'Avatar must be a JPEG, PNG, WebP or GIF image',
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Avatar image is required');
    }

    return this.usersService.uploadAvatar(userId, file);
  }
}
