import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RecommendationLimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 8;
}

export interface RecommendationLearnerSignals {
  categories: Record<string, number>;
  completedCourseIds: string[];
  engagementByCourseId: Record<string, number>;
  quizPerformanceByCourseId: Record<string, number>;
}

export interface RecommendationCandidate {
  id: string;
  title: string;
  category: string;
  description: string;
  popularity: number;
}

export interface RecommendationAiRequest {
  learnerId: string;
  limit: number;
  signals: RecommendationLearnerSignals;
  candidates: RecommendationCandidate[];
}

export interface RecommendationAiResponse {
  courseIds: string[];
}
