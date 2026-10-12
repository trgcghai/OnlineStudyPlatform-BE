import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import {
  RISK_FEATURE_VERSION,
  RISK_HIGH_THRESHOLD,
  RISK_RECOMPUTE_CONCURRENCY,
  RISK_SOURCE_AI,
} from './constants/risk.constants';
import {
  LearnerRiskInput,
  RiskBand,
  RiskLearnerDetailResponse,
  RiskLearnerListResponse,
  RiskLearnerQueryDto,
  RiskRecomputeResponse,
  RiskReminderResponse,
  RiskScoreResponse,
  RiskSummaryResponse,
} from './dto/risk.dto';
import { AiRiskClient, RiskModelStatusResponse } from './ai-risk.client';
import { RiskFeatureService } from './risk-feature.service';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskReminderService } from './risk-reminder.service';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly featureService: RiskFeatureService,
    private readonly persistenceService: RiskPersistenceService,
    private readonly aiGateway: AiRiskClient,
    private readonly reminderService: RiskReminderService,
  ) {}

  getModel(): Promise<RiskModelStatusResponse> {
    return this.aiGateway.getActiveModel();
  }

  async getSummary(
    courseId: string,
    instructorId: string,
  ): Promise<RiskSummaryResponse> {
    await this.assertInstructorOwnsCourse(courseId, instructorId);
    const scores = await this.persistenceService.findLatestByCourse(courseId);
    const highCount = scores.filter(
      (score) => score.band === RiskBand.HIGH,
    ).length;
    const mediumCount = scores.filter(
      (score) => score.band === RiskBand.MEDIUM,
    ).length;
    const lowCount = scores.filter(
      (score) => score.band === RiskBand.LOW,
    ).length;
    const latestCalculatedAt = scores.reduce<Date | null>((latest, score) => {
      if (!latest || score.calculatedAt > latest) return score.calculatedAt;
      return latest;
    }, null);

    return {
      totalScoredLearners: scores.length,
      lowCount,
      mediumCount,
      highCount,
      highRiskPercentage: scores.length
        ? Math.round((highCount / scores.length) * 10000) / 100
        : 0,
      latestCalculatedAt,
    };
  }

  async getLearners(
    courseId: string,
    instructorId: string,
    query: RiskLearnerQueryDto,
  ): Promise<RiskLearnerListResponse> {
    await this.assertInstructorOwnsCourse(courseId, instructorId);
    const learners = await this.persistenceService.findLatestByCourse(
      courseId,
      {
        threshold: query.threshold ?? RISK_HIGH_THRESHOLD,
        band: query.band,
      },
    );

    return { learners };
  }

  async getLearnerDetail(
    courseId: string,
    learnerId: string,
    instructorId: string,
  ): Promise<RiskLearnerDetailResponse> {
    await this.assertInstructorOwnsCourse(courseId, instructorId);
    const history = await this.persistenceService.findHistory(
      learnerId,
      courseId,
    );

    return {
      latest: history[0] ?? null,
      history,
    };
  }

  async recomputeCourse(
    courseId: string,
    instructorId: string,
    now = new Date(),
  ): Promise<RiskRecomputeResponse> {
    await this.assertInstructorOwnsCourse(courseId, instructorId);
    const enrollments =
      await this.featureService.getActiveEnrollmentsForCourse(courseId);
    let succeeded = 0;
    let failed = 0;

    await this.processWithConcurrency(
      enrollments,
      RISK_RECOMPUTE_CONCURRENCY,
      async (enrollment) => {
        try {
          await this.recomputeLearnerCourse(
            enrollment.learnerId,
            courseId,
            now,
          );
          succeeded += 1;
        } catch (error) {
          failed += 1;
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Risk recompute failed for ${courseId}/${enrollment.learnerId}: ${message}`,
          );
        }
      },
    );

    return { processed: enrollments.length, succeeded, failed };
  }

  async recomputeLearnerCourse(
    learnerId: string,
    courseId: string,
    now = new Date(),
  ): Promise<RiskScoreResponse> {
    const input = await this.featureService.extractForLearnerCourse(
      learnerId,
      courseId,
      now,
    );
    const jobKey = this.buildJobKey(courseId, learnerId, now);
    const result = await this.scoreLearnerCourse(input, jobKey);
    const score: RiskScoreResponse = {
      learnerId: input.learnerId,
      courseId: input.courseId,
      enrollmentId: input.enrollmentId,
      calculatedAt: now,
      score: result.score,
      band: result.band,
      featureVersion: RISK_FEATURE_VERSION,
      scoringVersion: result.scoringVersion,
      source: result.source,
      features: input.features,
      factors: result.factors,
    };

    const savedScore = await this.persistenceService.upsertScore(jobKey, score);
    this.enqueueAutoReminderSafely(savedScore);

    return savedScore;
  }

  async sendManualReminder(
    courseId: string,
    learnerId: string,
    instructorId: string,
  ): Promise<RiskReminderResponse> {
    await this.assertInstructorOwnsCourse(courseId, instructorId);
    const history = await this.persistenceService.findHistory(
      learnerId,
      courseId,
    );
    const latest = history[0];

    if (!latest) {
      throw new NotFoundException('Latest risk score not found');
    }

    if (latest.band !== RiskBand.HIGH) {
      throw new BadRequestException(
        'Smart Reminder can only be sent to high-risk learners',
      );
    }

    this.reminderService.enqueueManualReminder(latest);

    return { enqueued: true };
  }

  private async scoreLearnerCourse(
    input: LearnerRiskInput,
    jobKey: string,
  ): Promise<{
    score: number;
    band: RiskBand;
    scoringVersion: string;
    source: 'ai';
    factors: RiskScoreResponse['factors'];
  }> {
    const aiPrediction = await this.aiGateway.predict({
      learnerId: input.learnerId,
      courseId: input.courseId,
      snapshotId: jobKey,
      features: input.features,
    });

    return {
      score: aiPrediction.score,
      band: aiPrediction.band,
      scoringVersion: aiPrediction.modelVersion,
      source: RISK_SOURCE_AI,
      factors: aiPrediction.factors,
    };
  }

  private async processWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      async () => {
        while (nextIndex < items.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          await worker(items[currentIndex]);
        }
      },
    );

    await Promise.all(workers);
  }

  private enqueueAutoReminderSafely(score: RiskScoreResponse): void {
    try {
      this.reminderService.enqueueAutoReminderIfNeeded(score);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Smart reminder enqueue failed for ${score.courseId}/${score.learnerId}: ${message}`,
      );
    }
  }

  private buildJobKey(courseId: string, learnerId: string, date: Date): string {
    return `risk:${courseId}:${learnerId}:${date.toISOString().slice(0, 10)}`;
  }

  private async assertInstructorOwnsCourse(
    courseId: string,
    instructorId: string,
  ): Promise<void> {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.instructorId !== instructorId) {
      throw new ForbiddenException();
    }
  }
}
