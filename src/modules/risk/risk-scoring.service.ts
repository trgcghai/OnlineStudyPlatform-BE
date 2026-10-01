import { Injectable } from '@nestjs/common';
import {
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from './constants/risk.constants';
import {
  RiskBand,
  RiskFactor,
  RiskFeatures,
  RiskScoreResult,
} from './dto/risk.dto';

@Injectable()
export class RiskScoringService {
  score(features: RiskFeatures): RiskScoreResult {
    const factors: RiskFactor[] = [
      this.recencyFrequencyRisk(features),
      this.progressPaceRisk(features),
      this.watchEngagementRisk(features),
      this.quizPerformanceRisk(features),
      this.behaviorRisk(features),
    ].sort((a, b) => b.contribution - a.contribution);

    const score = this.clampScore(
      factors.reduce((total, factor) => total + factor.contribution, 0),
    );

    return {
      score,
      band: this.toBand(score),
      factors,
    };
  }

  toBand(score: number): RiskBand {
    if (score >= RISK_HIGH_THRESHOLD) return RiskBand.HIGH;
    if (score >= RISK_MEDIUM_THRESHOLD) return RiskBand.MEDIUM;
    return RiskBand.LOW;
  }

  clampScore(score: number): number {
    return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
  }

  private recencyFrequencyRisk(features: RiskFeatures): RiskFactor {
    const recency = Math.min(20, (features.lastActivityDays / 14) * 20);
    const frequency = Math.max(0, 10 - features.activityCount7d * 2);

    return {
      key: 'recency_frequency',
      label: 'Low recent activity',
      contribution: this.clampScore(Math.min(30, recency + frequency)),
      value: features.lastActivityDays,
    };
  }

  private progressPaceRisk(features: RiskFeatures): RiskFactor {
    return {
      key: 'progress_pace',
      label: 'Behind expected progress',
      contribution: this.clampScore(
        Math.min(25, features.expectedProgressGap * 0.5),
      ),
      value: features.expectedProgressGap,
    };
  }

  private watchEngagementRisk(features: RiskFeatures): RiskFactor {
    return {
      key: 'watch_engagement',
      label: 'Low lesson watch engagement',
      contribution: this.clampScore(
        Math.max(0, (1 - features.watchRatioAvg) * 20),
      ),
      value: features.watchRatioAvg,
    };
  }

  private quizPerformanceRisk(features: RiskFeatures): RiskFactor {
    const scoreRisk = Math.max(0, (100 - features.quizScoreAvgPercent) * 0.12);
    const passRisk = Math.max(0, (1 - features.quizPassRate) * 8);

    return {
      key: 'quiz_performance',
      label: 'Low quiz performance',
      contribution: this.clampScore(Math.min(20, scoreRisk + passRisk)),
      value: features.quizScoreAvgPercent,
    };
  }

  private behaviorRisk(features: RiskFeatures): RiskFactor {
    const lateRisk = Math.min(2, features.lateQuizCount);
    const abandonedRisk = Math.min(2, features.abandonedAttemptCount);
    const pauseRisk = Math.min(1, features.pauseCount / 20);

    return {
      key: 'learning_behavior',
      label: 'Risky learning behavior',
      contribution: this.clampScore(
        Math.min(5, lateRisk + abandonedRisk + pauseRisk),
      ),
      value:
        features.lateQuizCount +
        features.abandonedAttemptCount +
        features.pauseCount,
    };
  }
}
