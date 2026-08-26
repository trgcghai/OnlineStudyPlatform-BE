import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateLessonDto {
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration?: number;
}

export class UpdateLessonDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  duration?: number;
}

export class ReorderLessonsDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}

export class ListLessonsQueryDto {
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
  limit: number = 50;
}

export interface LessonResponse {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  materialUrl: string | null;
  duration: number;
  position: number;
  courseId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LessonListResult {
  items: LessonResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
