import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { RiskBand, RiskFactor, RiskFeatures } from './dto/risk.dto';

export interface RiskAiPrediction {
  score: number;
  band: RiskBand;
  modelVersion: string;
  factors: RiskFactor[];
}

export interface RiskModelInfo {
  modelName: string;
  modelVersion: string;
  featureVersion: string;
  trainedAt: string;
  sampleCount: number;
  metrics: Record<string, number>;
  artifactPath: string;
  isActive: boolean;
}

export interface RiskModelStatusResponse {
  model: RiskModelInfo | null;
}

interface AiPredictResponse {
  riskScore: number;
  riskBand: RiskBand;
  shapValues: Record<string, number>;
  modelVersion: string;
}

interface AiPredictRequest {
  learnerId: string;
  courseId: string;
  snapshotId: string;
  features: RiskFeatures;
}

const FEATURE_LABELS: Record<keyof RiskFeatures, string> = {
  lastActivityDays: 'Days since last activity',
  activityCount7d: 'Activity count in last 7 days',
  expectedProgressGap: 'Expected progress gap',
  courseProgressPercent: 'Course progress percent',
  quizScoreAvgPercent: 'Average quiz score percent',
  quizPassRate: 'Quiz pass rate',
  watchRatioAvg: 'Average watch ratio',
  abandonedAttemptCount: 'Abandoned attempt count',
  lateQuizCount: 'Late quiz count',
  completionVelocity: 'Completion velocity',
  totalWatchedSeconds: 'Total watched seconds',
  pauseCount: 'Pause count',
};

@Injectable()
export class AiRiskClient {
  private readonly logger = new Logger(AiRiskClient.name);

  constructor(private readonly aiHttpClient: AiHttpClientService) {}

  async getActiveModel(): Promise<RiskModelStatusResponse> {
    try {
      const payload = await this.aiHttpClient.get<unknown>(
        '/analytics/dropout-risk/model/active',
      );
      if (!this.isRiskModelInfo(payload)) return { model: null };

      return { model: payload };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI risk model status unavailable: ${message}`);
      return { model: null };
    }
  }

  async predict(request: AiPredictRequest): Promise<RiskAiPrediction> {
    try {
      const payload = await this.aiHttpClient.post<unknown>(
        '/analytics/dropout-risk/predict',
        request,
      );
      if (!this.isAiPredictResponse(payload)) {
        throw new ServiceUnavailableException(
          'AI risk model returned invalid prediction result',
        );
      }

      return {
        score: payload.riskScore,
        band: payload.riskBand,
        modelVersion: payload.modelVersion,
        factors: this.shapValuesToFactors(payload.shapValues, request.features),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `AI risk unavailable for ${request.courseId}/${request.learnerId}: ${message}`,
      );
      throw new ServiceUnavailableException(
        'Risk AI model is unavailable. Train and activate a model before recomputing risk.',
      );
    }
  }

  private isAiPredictResponse(value: unknown): value is AiPredictResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiPredictResponse>;
    return (
      typeof response.riskScore === 'number' &&
      Number.isFinite(response.riskScore) &&
      response.riskScore >= 0 &&
      response.riskScore <= 100 &&
      this.isRiskBand(response.riskBand) &&
      typeof response.modelVersion === 'string' &&
      response.modelVersion.trim().length > 0 &&
      Boolean(response.shapValues) &&
      typeof response.shapValues === 'object' &&
      !Array.isArray(response.shapValues)
    );
  }

  private isRiskModelInfo(value: unknown): value is RiskModelInfo {
    if (!value || typeof value !== 'object') return false;
    const model = value as Partial<RiskModelInfo>;

    return (
      typeof model.modelName === 'string' &&
      model.modelName.trim().length > 0 &&
      typeof model.modelVersion === 'string' &&
      model.modelVersion.trim().length > 0 &&
      typeof model.featureVersion === 'string' &&
      model.featureVersion.trim().length > 0 &&
      typeof model.trainedAt === 'string' &&
      model.trainedAt.trim().length > 0 &&
      typeof model.sampleCount === 'number' &&
      Number.isFinite(model.sampleCount) &&
      model.sampleCount >= 0 &&
      Boolean(model.metrics) &&
      typeof model.metrics === 'object' &&
      !Array.isArray(model.metrics) &&
      Object.values(model.metrics).every(
        (metric) => typeof metric === 'number' && Number.isFinite(metric),
      ) &&
      typeof model.artifactPath === 'string' &&
      model.artifactPath.trim().length > 0 &&
      typeof model.isActive === 'boolean'
    );
  }

  private isRiskBand(value: unknown): value is RiskBand {
    return (
      value === RiskBand.LOW ||
      value === RiskBand.MEDIUM ||
      value === RiskBand.HIGH
    );
  }

  private shapValuesToFactors(
    shapValues: Record<string, number>,
    features: RiskFeatures,
  ): RiskFactor[] {
    return Object.entries(shapValues)
      .flatMap(([key, contribution]) => {
        if (!this.isRiskFeatureKey(key) || !Number.isFinite(contribution))
          return [];
        return [
          {
            key,
            label: FEATURE_LABELS[key],
            contribution,
            value: features[key],
          },
        ];
      })
      .sort((a, b) => b.contribution - a.contribution);
  }

  private isRiskFeatureKey(key: string): key is keyof RiskFeatures {
    return key in FEATURE_LABELS;
  }
}
