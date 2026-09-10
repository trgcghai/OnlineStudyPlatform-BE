import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export interface EnrollmentCourseInstructorResponse {
  id: string;
  name: string;
}

export interface EnrollmentCourseResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  price: number;
  thumbnail: string | null;
  instructorId: string;
  instructor?: EnrollmentCourseInstructorResponse;
}

export interface EnrollmentResponse {
  id: string;
  learnerId: string;
  courseId: string;
  progress: string;
  enrolledAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
  course?: EnrollmentCourseResponse;
}

export class ListCourseEnrollmentsQueryDto {
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
}

export type CourseEnrollmentCompletionStatus =
  'not_started' | 'in_progress' | 'completed';

export interface CourseEnrollmentLearnerResponse {
  id: string;
  name: string;
  email: string;
}

export interface CourseEnrollmentQuizSummaryResponse {
  bestScore: number | null;
  latestAttemptAt: Date | null;
  passed: boolean | null;
}

export interface CourseEnrollmentListItemResponse {
  enrollmentId: string;
  learner: CourseEnrollmentLearnerResponse;
  enrolledAt: Date;
  progress: string;
  completionStatus: CourseEnrollmentCompletionStatus;
  completedAt: Date | null;
  lastActivityAt: Date | null;
  quizSummary: CourseEnrollmentQuizSummaryResponse;
}

export interface CourseEnrollmentListResponse {
  items: CourseEnrollmentListItemResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
