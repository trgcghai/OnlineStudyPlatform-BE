import { RiskBand, RiskFeatures } from './dto/risk.dto';
import { RiskScoringService } from './risk-scoring.service';

describe('RiskScoringService', () => {
  let service: RiskScoringService;

  beforeEach(() => {
    service = new RiskScoringService();
  });

  const lowRiskFeatures: RiskFeatures = {
    lastActivityDays: 0,
    activityCount7d: 10,
    expectedProgressGap: 0,
    courseProgressPercent: 90,
    quizScoreAvgPercent: 95,
    quizPassRate: 1,
    watchRatioAvg: 0.95,
    abandonedAttemptCount: 0,
    lateQuizCount: 0,
    completionVelocity: 2,
    totalWatchedSeconds: 3600,
    pauseCount: 0,
  };

  it('maps band boundaries using analytics-note thresholds', () => {
    expect(service.toBand(29.99)).toBe(RiskBand.LOW);
    expect(service.toBand(30)).toBe(RiskBand.MEDIUM);
    expect(service.toBand(69.99)).toBe(RiskBand.MEDIUM);
    expect(service.toBand(70)).toBe(RiskBand.HIGH);
  });

  it('clamps scores to the 0..100 range', () => {
    expect(service.clampScore(-5)).toBe(0);
    expect(service.clampScore(105)).toBe(100);
    expect(service.clampScore(55.678)).toBe(55.68);
  });

  it('sorts factors by contribution descending', () => {
    const result = service.score({
      ...lowRiskFeatures,
      lastActivityDays: 30,
      activityCount7d: 0,
      expectedProgressGap: 60,
      watchRatioAvg: 0.1,
      quizScoreAvgPercent: 20,
      quizPassRate: 0,
    });

    const contributions = result.factors.map((factor) => factor.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });

  it('produces high band for a clearly high-risk feature set', () => {
    const result = service.score({
      ...lowRiskFeatures,
      lastActivityDays: 21,
      activityCount7d: 0,
      expectedProgressGap: 55,
      courseProgressPercent: 5,
      quizScoreAvgPercent: 25,
      quizPassRate: 0,
      watchRatioAvg: 0.15,
      abandonedAttemptCount: 3,
      lateQuizCount: 2,
      pauseCount: 30,
    });

    expect(result.band).toBe(RiskBand.HIGH);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.factors[0].contribution).toBeGreaterThan(0);
  });

  it('produces low band for a healthy feature set', () => {
    const result = service.score(lowRiskFeatures);

    expect(result.band).toBe(RiskBand.LOW);
    expect(result.score).toBeLessThan(30);
  });
});
