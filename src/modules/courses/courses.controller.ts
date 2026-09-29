import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  COURSE_THUMBNAIL_ALLOWED_MIME_TYPES,
  COURSE_THUMBNAIL_FIELD_NAME,
  COURSE_THUMBNAIL_MAX_SIZE_BYTES,
} from '../../common/constants/file.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Cached, InvalidateCache } from '../redis/redis.decorators';
import { UserRole } from '../users/entities/user.entity';
import { CoursesService } from './courses.service';
import {
  CreateCourseDto,
  ListCoursesQueryDto,
  ReviewCourseStatusDto,
  UpdateCourseDto,
} from './dto/course.dto';
import { ThumbnailUploadExceptionFilter } from './filters/thumbnail-upload-exception.filter';

@Controller('courses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @InvalidateCache(['courses:public:list', 'instructor:courses:list'])
  @Roles(UserRole.INSTRUCTOR)
  create(
    @CurrentUser('id') instructorId: string,
    @Body() dto: CreateCourseDto,
  ) {
    return this.coursesService.create(instructorId, dto);
  }

  @Get('me')
  @Cached({ namespace: 'instructor:courses:list', ttl: 60, scope: 'user' })
  @Roles(UserRole.INSTRUCTOR)
  findMine(
    @CurrentUser('id') instructorId: string,
    @Query() query: ListCoursesQueryDto,
  ) {
    return this.coursesService.findMine(instructorId, query);
  }

  @Get('approvals')
  @Roles(UserRole.ADMIN)
  findPendingApprovals(@Query() query: ListCoursesQueryDto) {
    return this.coursesService.findPendingApprovals(query);
  }

  @Get(':id')
  @Cached({ namespace: 'instructor:courses:detail', ttl: 60, scope: 'user' })
  @Roles(UserRole.INSTRUCTOR)
  getOwned(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.getOwned(id, instructorId);
  }

  @Post(':id/request-publish')
  @InvalidateCache([
    'courses:public:list',
    'courses:public:detail',
    'instructor:courses:list',
    'instructor:courses:detail',
    'learning:course',
    'learning:lesson',
  ])
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  requestPublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.requestPublish(id, instructorId);
  }

  @Patch(':id/status')
  @InvalidateCache([
    'courses:public:list',
    'courses:public:detail',
    'instructor:courses:list',
    'instructor:courses:detail',
    'learning:course',
    'learning:lesson',
  ])
  @Roles(UserRole.ADMIN)
  reviewCourseStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCourseStatusDto,
  ) {
    return this.coursesService.reviewCourseStatus(id, dto);
  }

  @Patch(':id')
  @InvalidateCache([
    'courses:public:list',
    'courses:public:detail',
    'instructor:courses:list',
    'instructor:courses:detail',
    'learning:course',
    'learning:lesson',
  ])
  @Roles(UserRole.INSTRUCTOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.coursesService.update(id, instructorId, dto);
  }

  @Delete(':id')
  @InvalidateCache([
    'courses:public:list',
    'courses:public:detail',
    'instructor:courses:list',
    'instructor:courses:detail',
    'learning:course',
    'learning:lesson',
  ])
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
  ) {
    return this.coursesService.remove(id, instructorId);
  }

  @Post(':id/thumbnail')
  @InvalidateCache([
    'courses:public:list',
    'courses:public:detail',
    'instructor:courses:list',
    'instructor:courses:detail',
    'learning:course',
    'learning:lesson',
  ])
  @Roles(UserRole.INSTRUCTOR)
  @HttpCode(HttpStatus.OK)
  @UseFilters(ThumbnailUploadExceptionFilter)
  @UseInterceptors(
    FileInterceptor(COURSE_THUMBNAIL_FIELD_NAME, {
      limits: { fileSize: COURSE_THUMBNAIL_MAX_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!COURSE_THUMBNAIL_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(
            new BadRequestException(
              'Course thumbnail must be a JPEG, PNG, WebP or GIF image',
            ),
            false,
          );
          return;
        }

        callback(null, true);
      },
    }),
  )
  uploadThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') instructorId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Course thumbnail is required');
    }

    return this.coursesService.uploadThumbnail(id, instructorId, file);
  }
}
