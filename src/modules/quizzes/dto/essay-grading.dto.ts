import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
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
