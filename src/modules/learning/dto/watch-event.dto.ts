import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { LessonWatchEventType } from '../entities/lesson-watch-event.entity';

export class CreateWatchEventDto {
  @IsString()
  @MaxLength(160)
  idempotencyKey!: string;

  @IsEnum(LessonWatchEventType)
  eventType!: LessonWatchEventType;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  watchedSeconds!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationSeconds!: number;

  @IsOptional()
  @IsDateString()
  clientCreatedAt?: string;
}
