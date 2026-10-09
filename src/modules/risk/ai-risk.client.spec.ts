import { ServiceUnavailableException } from '@nestjs/common';
import { AiHttpClientService } from '../ai-client/ai-http-client.service';
import { RiskBand, RiskFeatures } from './dto/risk.dto';
import { AiRiskClient } from './ai-risk.client';

describe('AiRiskClient', () => {
  const features: RiskFeatures = {
    lastActivityDays: 4,
    activityCount7d: 2,
    expectedProgressGap: 15,
    courseProgressPercent: 40,
    quizScoreAvgPercent: 72,
    quizPassRate: 0.8,
    watchRatioAvg: 0.6,
    abandonedAttemptCount: 1,
    lateQuizCount: 2,
    completionVelocity: 0.5,
    totalWatchedSeconds: 900,
    pauseCount: 3,
  };
  const request = {
    learnerId: 'learner-1',
    courseId: 'course-1',
    snapshotId: 'snapshot-1',
    features,
  };
  const model = {
    modelName: 'dropout-risk-xgboost',
    modelVersion: 'dropout-xgb-v1',
    featureVersion: 'dropout_features_v1',
    trainedAt: '2026-10-01T00:00:00Z',
    sampleCount: 125,
    metrics: { mae: 7.8 },
    artifactPath: 'models/dropout-xgb-v1/model.json',
    isActive: true,
  };

  it('maps a valid prediction and delegates to the shared client', async () => {
    const post = jest.fn().mockResolvedValue({
      riskScore: 82.4,
      riskBand: RiskBand.HIGH,
      shapValues: { lastActivityDays: 1.8, lateQuizCount: 0.9 },
      modelVersion: 'dropout-xgb-v1',
    });
    const client = new AiRiskClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.predict(request)).resolves.toEqual({
      score: 82.4,
      band: RiskBand.HIGH,
      modelVersion: 'dropout-xgb-v1',
      factors: [
        {
          key: 'lastActivityDays',
          label: 'Days since last activity',
          contribution: 1.8,
          value: 4,
        },
        {
          key: 'lateQuizCount',
          label: 'Late quiz count',
          contribution: 0.9,
          value: 2,
        },
      ],
    });
    expect(post).toHaveBeenCalledWith(
      '/analytics/dropout-risk/predict',
      request,
    );
  });

  it('returns an unavailable model when active-model lookup fails', async () => {
    const get = jest.fn().mockRejectedValue(new Error('offline'));
    const client = new AiRiskClient({
      get,
    } as unknown as AiHttpClientService);

    await expect(client.getActiveModel()).resolves.toEqual({ model: null });
  });

  it('returns validated active model info', async () => {
    const get = jest.fn().mockResolvedValue(model);
    const client = new AiRiskClient({
      get,
    } as unknown as AiHttpClientService);

    await expect(client.getActiveModel()).resolves.toEqual({ model });
    expect(get).toHaveBeenCalledWith('/analytics/dropout-risk/model/active');
  });

  it('throws ServiceUnavailableException when prediction service fails', async () => {
    const post = jest.fn().mockRejectedValue(new Error('offline'));
    const client = new AiRiskClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.predict(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailableException when prediction payload is invalid', async () => {
    const post = jest.fn().mockResolvedValue({ riskScore: '82.4' });
    const client = new AiRiskClient({
      post,
    } as unknown as AiHttpClientService);

    await expect(client.predict(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
