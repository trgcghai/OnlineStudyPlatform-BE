import { ConfigService } from '@nestjs/config';
import { RiskBand, RiskFeatures } from './dto/risk.dto';
import { RiskAiGatewayService } from './risk-ai-gateway.service';

describe('RiskAiGatewayService', () => {
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
    snapshotId: 'risk:course-1:learner-1:2026-09-30',
    features,
  };
  const model = {
    modelName: 'dropout-risk-xgboost',
    modelVersion: 'dropout-xgb-v1',
    featureVersion: 'dropout_features_v1',
    trainedAt: '2026-10-01T00:00:00Z',
    sampleCount: 125,
    metrics: { mae: 7.8, rmse: 10.4 },
    artifactPath: 'models/dropout-risk/dropout-xgb-v1/model.json',
    isActive: true,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(values: Record<string, unknown>) {
    return new RiskAiGatewayService({
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService);
  }

  it('returns validated AI prediction and converts shap values to sorted factors', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          riskScore: 82.4,
          riskBand: RiskBand.HIGH,
          shapValues: {
            lateQuizCount: 0.9,
            lastActivityDays: 1.8,
            unknownFeature: 100,
          },
          modelVersion: 'dropout-xgb-v1',
        }),
    } as Response);
    const service = createService({
      AI_URL: 'http://ai.local/',
      AI_TOKEN: 'secret',
      AI_TIMEOUT_MS: 5000,
    });

    const result = await service.predict(request);

    expect(result).toEqual({
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
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.local/analytics/dropout-risk/predict',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify(request),
      }),
    );
  });

  it('returns null when AI_URL is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const service = createService({});

    await expect(service.predict(request)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null model status when AI_URL is missing', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const service = createService({});

    await expect(service.getActiveModel()).resolves.toEqual({ model: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns active model info from AI', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(model),
    } as Response);
    const service = createService({
      AI_URL: 'http://ai.local/',
      AI_TOKEN: 'secret',
      AI_TIMEOUT_MS: 5000,
    });

    await expect(service.getActiveModel()).resolves.toEqual({ model });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.local/analytics/dropout-risk/model/active',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns null model when AI active model endpoint returns 404', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404 } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.getActiveModel()).resolves.toEqual({ model: null });
  });

  it('returns training result from AI train endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(model),
    } as Response);
    const service = createService({
      AI_URL: 'http://ai.local/',
      AI_TOKEN: 'secret',
    });

    await expect(service.trainModel()).resolves.toEqual(model);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ai.local/analytics/dropout-risk/train',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('throws friendly bad request when AI train returns low-sample 400', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Need at least 10 risk_scores samples'),
    } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.trainModel()).rejects.toThrow(
      'Chưa đủ dữ liệu risk_scores để train model. Cần ít nhất 10 mẫu.',
    );
  });

  it('does not report unrelated AI train 400 errors as low-sample failures', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Unsupported feature schema'),
    } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.trainModel()).rejects.toThrow(
      'AI risk model training request failed',
    );
  });

  it('returns null when fetch returns a non-success response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404 } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.predict(request)).resolves.toBeNull();
  });

  it('returns null when the response shape is invalid', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ riskScore: '82.4' }),
    } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.predict(request)).resolves.toBeNull();
  });

  it('returns null when the AI score is outside the risk range', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          riskScore: 101,
          riskBand: RiskBand.HIGH,
          shapValues: {},
          modelVersion: 'dropout-xgb-v1',
        }),
    } as Response);
    const service = createService({ AI_URL: 'http://ai.local' });

    await expect(service.predict(request)).resolves.toBeNull();
  });

  it('omits Authorization when AI_TOKEN is empty', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          riskScore: 20,
          riskBand: RiskBand.LOW,
          shapValues: {},
          modelVersion: 'dropout-xgb-v1',
        }),
    } as Response);
    const service = createService({ AI_URL: 'http://ai.local', AI_TOKEN: '' });

    await service.predict(request);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
});
