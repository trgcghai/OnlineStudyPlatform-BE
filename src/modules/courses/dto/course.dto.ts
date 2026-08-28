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
  ValidateIf,
} from 'class-validator';
import { CourseStatus, LearningOrder } from '../entities/course.entity';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const COURSE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'category',
  'status',
] as const;

export const PUBLIC_COURSE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'title',
  'category',
] as const;

export type CourseSortField = (typeof COURSE_SORT_FIELDS)[number];
export type PublicCourseSortField = (typeof PUBLIC_COURSE_SORT_FIELDS)[number];
export type SortOrder = 'ASC' | 'DESC';

export const COURSE_REVIEW_STATUSES = [
  CourseStatus.PUBLISHED,
  CourseStatus.REJECTED,
] as const;

export type CourseReviewStatus = (typeof COURSE_REVIEW_STATUSES)[number];

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

  @IsOptional()
  @IsEnum(LearningOrder)
  learningOrder?: LearningOrder;
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

  @IsOptional()
  @IsEnum(LearningOrder)
  learningOrder?: LearningOrder;
}

export class ReviewCourseStatusDto {
  @IsIn(COURSE_REVIEW_STATUSES)
  status!: CourseReviewStatus;

  @ValidateIf((dto: ReviewCourseStatusDto) => dto.rejectReason !== undefined)
  @Transform(trimString)
  @IsString()
  @Length(1, 1000)
  rejectReason?: string;
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
  sortBy: CourseSortField = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: SortOrder = 'DESC';
}

export class ListPublishedCoursesQueryDto {
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
  @IsIn(PUBLIC_COURSE_SORT_FIELDS)
  sortBy: PublicCourseSortField = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortOrder: SortOrder = 'DESC';
}

export class PublishedCourseLimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;
}

export interface CourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  status: CourseStatus;
  learningOrder: LearningOrder;
  rejectReason: string | null;
  instructorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CourseInstructorSummary {
  id: string;
  name: string;
  email: string;
}

export interface PublicCourseInstructorSummary {
  id: string;
  name: string;
}

export interface PublicCourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail: string | null;
  learningOrder: LearningOrder;
  instructorId: string;
  instructor?: PublicCourseInstructorSummary;
  createdAt: Date;
  updatedAt: Date;
  isEnrolled?: boolean;
}

export interface PublicCourseListResult {
  items: PublicCourseResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CourseApprovalResponse extends CourseResponse {
  instructor: CourseInstructorSummary;
}

export interface CourseApprovalListResult {
  items: CourseApprovalResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CourseListResult {
  items: CourseResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
