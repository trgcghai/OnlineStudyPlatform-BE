import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { LESSON_IMPORT_MAX_SIZE_BYTES } from '../../../common/constants/file.constant';
import { LessonImportStatus } from '../entities/lesson-import.entity';

export class InitiateLessonImportDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 255)
  @Matches(/\.zip$/i, { message: 'fileName must end with .zip' })
  fileName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LESSON_IMPORT_MAX_SIZE_BYTES)
  fileSize!: number;
}

export interface LessonImportPart {
  partNumber: number;
  url: string;
}

export interface LessonImportInitiateResponse {
  importId: string;
  partSize: number;
  parts: LessonImportPart[];
  expiresAt: Date;
}

export interface LessonImportStatusResponse {
  importId: string;
  status: LessonImportStatus;
  progress: number;
  errorDetails: string[];
  createdLessonCount: number;
  failedRowCount: 0;
  firstPosition: number | null;
  lastPosition: number | null;
  expiresAt: Date;
  createdAt: Date;
  completedAt: Date | null;
}
