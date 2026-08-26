import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CoursesService } from './courses.service';
import {
  ListPublishedCoursesQueryDto,
  PublishedCourseLimitQueryDto,
} from './dto/course.dto';

@Controller('courses/public')
export class PublicCoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  findPublished(@Query() query: ListPublishedCoursesQueryDto) {
    return this.coursesService.findPublished(query);
  }

  @Get('suggestion')
  findPublishedSuggestions(@Query() query: PublishedCourseLimitQueryDto) {
    return this.coursesService.findPublishedSuggestions(query);
  }

  @Get('latest')
  findLatestPublished(@Query() query: PublishedCourseLimitQueryDto) {
    return this.coursesService.findLatestPublished(query);
  }

  @Get(':id')
  getPublished(@Param('id', ParseUUIDPipe) id: string) {
    return this.coursesService.getPublished(id);
  }
}
