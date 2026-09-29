import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../auth/dto/auth.dto';
import { Cached } from '../redis/redis.decorators';
import { CoursesService } from './courses.service';
import {
  ListPublishedCoursesQueryDto,
  PublishedCourseLimitQueryDto,
} from './dto/course.dto';

@Controller('courses/public')
export class PublicCoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @Cached({ namespace: 'courses:public:list', ttl: 60 })
  findPublished(@Query() query: ListPublishedCoursesQueryDto) {
    return this.coursesService.findPublished(query);
  }

  @Get('suggestion')
  @Cached({ namespace: 'courses:public:list', ttl: 60 })
  findPublishedSuggestions(@Query() query: PublishedCourseLimitQueryDto) {
    return this.coursesService.findPublishedSuggestions(query);
  }

  @Get('latest')
  @Cached({ namespace: 'courses:public:list', ttl: 60 })
  findLatestPublished(@Query() query: PublishedCourseLimitQueryDto) {
    return this.coursesService.findLatestPublished(query);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Cached({
    namespace: 'courses:public:detail',
    ttl: 120,
    scope: 'anonymous-or-user',
  })
  getPublished(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user?: AuthenticatedUser | null,
  ) {
    return this.coursesService.getPublished(id, user);
  }
}
