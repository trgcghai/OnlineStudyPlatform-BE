import {
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
  RISK_SCORING_VERSION,
  RISK_SOURCE_HEURISTIC,
} from './constants/risk.constants';
import {
  RiskBand,
  RiskLearnerDetailResponse,
  RiskLearnerListResponse,
  RiskLearnerQueryDto,
  RiskRecomputeResponse,
  RiskScoreResponse,
  RiskSummaryResponse,
} from './dto/risk.dto';
import { RiskFeatureService } from './risk-feature.service';
import { RiskPersistenceService } from './risk-persistence.service';
import { RiskScoringService } from './risk-scoring.service';

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    private readonly featureService: RiskFeatureService,
    private readonly scoringService: RiskScoringService,
    private readonly persistenceService: RiskPersistenceService,
  ) {}

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

    for (const enrollment of enrollments) {
      try {
        await this.recomputeLearnerCourse(enrollment.learnerId, courseId, now);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Risk recompute failed for ${courseId}/${enrollment.learnerId}: ${message}`,
        );
      }
    }

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
    const result = this.scoringService.score(input.features);
    const score: RiskScoreResponse = {
      learnerId: input.learnerId,
      courseId: input.courseId,
      enrollmentId: input.enrollmentId,
      calculatedAt: now,
      score: result.score,
      band: result.band,
      featureVersion: RISK_FEATURE_VERSION,
      scoringVersion: RISK_SCORING_VERSION,
      source: RISK_SOURCE_HEURISTIC,
      features: input.features,
      factors: result.factors,
    };

    return this.persistenceService.upsertScore(
      this.buildJobKey(courseId, learnerId, now),
      score,
    );
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
