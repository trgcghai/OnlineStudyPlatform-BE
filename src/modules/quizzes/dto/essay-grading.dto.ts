import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  QuizAttemptQuestionStatus,
  QuizAttemptStatus,
} from './quiz-attempt.dto';

export enum EssayGradingStatusFilter {
  PENDING = 'pending',
  GRADED = 'graded',
  ALL = 'all',
}

export class ListEssayGradingSubmissionsQueryDto {
  @IsOptional()
  @IsEnum(EssayGradingStatusFilter)
  status?: EssayGradingStatusFilter;

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
}

export class GradeEssayAnswerDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  points!: number;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  feedback?: string;
}

export interface EssayGradingLearnerResponse {
  id: string;
  name: string;
  email: string;
}

export interface EssayGradingQuestionResponse {
  questionId: string;
  content: string;
  text: string;
  score: number;
  maxScore: number;
  status: QuizAttemptQuestionStatus;
  feedback?: string;
  gradedAt?: string;
  gradedBy?: string;
}

export interface EssayGradingSubmissionResponse {
  attemptId: string;
  quizId: string;
  learner: EssayGradingLearnerResponse;
  submittedAt: Date | null;
  totalScore: number;
  totalPoints: number;
  passScore: number;
  passScorePoints: number;
  passed: boolean;
  status: QuizAttemptStatus;
  pendingEssayCount: number;
  essays: EssayGradingQuestionResponse[];
}

export interface EssayGradingSubmissionListResponse {
  items: EssayGradingSubmissionResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
