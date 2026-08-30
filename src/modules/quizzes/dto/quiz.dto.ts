import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../entities/question.entity';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type!: QuestionType;

  @Transform(trimString)
  @IsString()
  @Length(1, 4000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  correctAnswers?: number[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  points!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateQuestionDto {
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 4000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  correctAnswers?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  points?: number;
}

export class CreateQuizDto {
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
  @Max(1440)
  timeLimitMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passScore?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}

export class UpdateQuizDto {
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
  @Max(1440)
  timeLimitMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  passScore?: number;
}

export class ReorderQuestionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds!: string[];
}

export interface QuestionResponse {
  id: string;
  quizId: string;
  type: QuestionType;
  content: string;
  options: string[];
  correctAnswers: number[];
  points: number;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizResponse {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number;
  totalPoints: number;
  passScorePoints: number;
  questions: QuestionResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizSummaryResponse {
  id: string;
  lessonId: string;
  courseId: string;
  title: string;
  description: string;
  timeLimitMinutes: number | null;
  passScore: number;
  totalPoints: number;
  passScorePoints: number;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
}
