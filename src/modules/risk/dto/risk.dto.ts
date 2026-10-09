import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

export enum RiskBand {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export type RiskSource = 'heuristic' | 'ai';

export interface RiskFeatures {
  lastActivityDays: number;
  activityCount7d: number;
  expectedProgressGap: number;
  courseProgressPercent: number;
  quizScoreAvgPercent: number;
  quizPassRate: number;
  watchRatioAvg: number;
  abandonedAttemptCount: number;
  lateQuizCount: number;
  completionVelocity: number;
  totalWatchedSeconds: number;
  pauseCount: number;
}

export interface RiskFactor {
  key: string;
  label: string;
  contribution: number;
  value: number;
}

export interface LearnerRiskInput {
  learnerId: string;
  courseId: string;
  enrollmentId: string;
  features: RiskFeatures;
}

export interface RiskScoreResult {
  score: number;
  band: RiskBand;
  factors: RiskFactor[];
}

export interface RiskScoreResponse {
  learnerId: string;
  courseId: string;
  enrollmentId: string;
  calculatedAt: Date;
  score: number;
  band: RiskBand;
  featureVersion: string;
  scoringVersion: string;
  source: RiskSource;
  features: RiskFeatures;
  factors: RiskFactor[];
}

export interface RiskSummaryResponse {
  totalScoredLearners: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  highRiskPercentage: number;
  latestCalculatedAt: Date | null;
}

export interface RiskLearnerListResponse {
  learners: RiskScoreResponse[];
}

export interface RiskLearnerDetailResponse {
  latest: RiskScoreResponse | null;
  history: RiskScoreResponse[];
}

export interface RiskRecomputeResponse {
  processed: number;
  succeeded: number;
  failed: number;
}

export class RiskLearnerQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @Max(100)
  threshold?: number;

  @IsOptional()
  @IsEnum(RiskBand)
  band?: RiskBand;
}
