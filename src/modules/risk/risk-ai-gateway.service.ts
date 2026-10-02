import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

export type RiskModelTrainingResult = RiskModelInfo;

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
export class RiskAiGatewayService {
  private readonly logger = new Logger(RiskAiGatewayService.name);

  constructor(private readonly configService: ConfigService) {}

  async getActiveModel(): Promise<RiskModelStatusResponse> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');

    if (!aiUrl) {
      return { model: null };
    }

    try {
      const response = await this.fetchAi(
        `${aiUrl}/analytics/dropout-risk/model/active`,
        {
          method: 'GET',
        },
      );

      if (!response.ok) return { model: null };

      const payload: unknown = await response.json();
      if (!this.isRiskModelInfo(payload)) return { model: null };

      return { model: payload };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI risk model status unavailable: ${message}`);
      return { model: null };
    }
  }

  async trainModel(): Promise<RiskModelTrainingResult> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');

    if (!aiUrl) {
      throw new ServiceUnavailableException(
        'AI risk model service is not configured',
      );
    }

    try {
      const response = await this.fetchAi(
        `${aiUrl}/analytics/dropout-risk/train`,
        {
          method: 'POST',
        },
      );

      if (response.status === 400) {
        const errorText = await this.readResponseText(response);
        if (this.isLowSampleTrainingError(errorText)) {
          throw new BadRequestException(
            'Chưa đủ dữ liệu risk_scores để train model. Cần ít nhất 10 mẫu.',
          );
        }

        throw new BadRequestException('AI risk model training request failed');
      }

      if (!response.ok) {
        throw new ServiceUnavailableException('AI risk model training failed');
      }

      const payload: unknown = await response.json();
      if (!this.isRiskModelInfo(payload)) {
        throw new ServiceUnavailableException(
          'AI risk model returned invalid training result',
        );
      }

      return payload;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI risk training failed: ${message}`);
      throw new ServiceUnavailableException(
        'AI risk model service is unavailable',
      );
    }
  }

  async predict(request: AiPredictRequest): Promise<RiskAiPrediction | null> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');

    if (!aiUrl) return null;

    const timeoutMs = this.configService.get<number>('AI_TIMEOUT_MS') ?? 4500;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchAi(
        `${aiUrl}/analytics/dropout-risk/predict`,
        {
          method: 'POST',
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        this.logger.warn(`AI risk returned HTTP ${response.status}`);
        return null;
      }

      const payload: unknown = await response.json();
      if (!this.isAiPredictResponse(payload)) return null;

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
      return null;
    } finally {
      clearTimeout(timeout);
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

  private async fetchAi(url: string, init: RequestInit): Promise<Response> {
    const token = this.configService.get<string>('AI_TOKEN');
    const timeoutMs = this.configService.get<number>('AI_TIMEOUT_MS') ?? 4500;
    const controller = init.signal ? null : new AbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      return await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
        signal: init.signal ?? controller?.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async readResponseText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  private isLowSampleTrainingError(errorText: string): boolean {
    const normalized = errorText.toLowerCase();

    return normalized.includes('risk_scores') || normalized.includes('sample');
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
