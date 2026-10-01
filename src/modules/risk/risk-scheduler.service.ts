import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RISK_DAILY_CRON } from './constants/risk.constants';
import { RiskFeatureService } from './risk-feature.service';
import { RiskService } from './risk.service';

@Injectable()
export class RiskSchedulerService {
  private readonly logger = new Logger(RiskSchedulerService.name);

  constructor(
    private readonly featureService: RiskFeatureService,
    private readonly riskService: RiskService,
  ) {}

  @Cron(RISK_DAILY_CRON)
  async recomputeDailyRisk(): Promise<void> {
    const enrollments = await this.featureService.getAllActiveEnrollments();
    let succeeded = 0;
    let failed = 0;

    for (const enrollment of enrollments) {
      try {
        await this.riskService.recomputeLearnerCourse(
          enrollment.learnerId,
          enrollment.courseId,
        );
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Daily risk recompute failed for ${enrollment.courseId}/${enrollment.learnerId}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Daily risk recompute processed=${enrollments.length} succeeded=${succeeded} failed=${failed}`,
    );
  }
}
