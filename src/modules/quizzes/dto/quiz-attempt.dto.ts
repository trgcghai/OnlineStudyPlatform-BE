import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../entities/question.entity';

export enum QuizAttemptStatus {
  IN_PROGRESS = 'in_progress',
  PASSED = 'passed',
  NOT_PASSED = 'not_passed',
  ABANDONED = 'abandoned',
}

export class SubmitQuizAnswerDto {
  @IsUUID()
  questionId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  selectedOptionIndexes?: number[];

  @IsOptional()
  @IsString()
  @Length(0, 10000)
  text?: string;
}

export class SubmitQuizAttemptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitQuizAnswerDto)
  answers!: SubmitQuizAnswerDto[];
}

export interface LearnerQuizQuestionResponse {
  id: string;
  quizId: string;
  type: QuestionType;
  content: string;
  options: string[];
  isMultipleChoice: boolean;
  maxSelectableOptions: number | null;
  points: number;
  position: number;
}

export interface LearnerQuizResponse {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number;
  totalPoints: number;
  passScorePoints: number;
  questions: LearnerQuizQuestionResponse[];
}

export interface LearnerQuizLoadResponse {
  quiz: LearnerQuizResponse | null;
}

export interface QuizAttemptStartResponse {
  attemptId: string;
  quiz: LearnerQuizResponse;
  startedAt: Date;
  timeLimitMinutes: number | null;
}

export type QuizAttemptQuestionStatus =
  'correct' | 'partial' | 'wrong' | 'pending_grading';

export interface QuizAttemptQuestionResult {
  questionId: string;
  type: QuestionType;
  selectedOptionIndexes?: number[];
  text?: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  status: QuizAttemptQuestionStatus;
}

export interface QuizAttemptResultResponse {
  attemptId: string;
  quizId: string;
  startedAt: Date;
  submittedAt: Date | null;
  timeLimitMinutes: number | null;
  isLate: boolean;
  lateSeconds: number;
  totalScore: number;
  totalPoints: number;
  passScore: number;
  passScorePoints: number;
  passed: boolean;
  status: QuizAttemptStatus;
  correctCount: number;
  wrongCount: number;
  pendingEssayCount: number;
  questions: QuizAttemptQuestionResult[];
}
