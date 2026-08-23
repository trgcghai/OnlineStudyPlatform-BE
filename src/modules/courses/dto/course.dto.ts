import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CourseStatus } from '../entities/course.entity';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const COURSE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'category',
  'status',
] as const;

export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];
export type SortOrder = 'ASC' | 'DESC';

export class CreateCourseDto {
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  title!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 5000)
  description!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category!: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(2, 150)
  title?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 5000)
  description?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category?: string;
}

export class ListCoursesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  q?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 80)
  category?: string;

  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  @IsOptional()
  @IsIn(COURSE_SORT_FIELDS)
  sortBy: CourseSortField = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: SortOrder = 'DESC';
}

export interface CourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  status: CourseStatus;
  instructorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseListResult {
  items: CourseResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
