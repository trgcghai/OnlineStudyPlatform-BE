import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { LessonProgress } from '../learning/entities/lesson-progress.entity';
import {
  LessonWatchEvent,
  LessonWatchEventType,
} from '../learning/entities/lesson-watch-event.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { LearnerRiskInput, RiskFeatures } from './dto/risk.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class RiskFeatureService {
  constructor(
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(LearningAnalyticsEvent)
    private readonly analyticsEventsRepository: Repository<LearningAnalyticsEvent>,
    @InjectRepository(LessonProgress)
    private readonly lessonProgressRepository: Repository<LessonProgress>,
    @InjectRepository(LessonWatchEvent)
    private readonly lessonWatchEventsRepository: Repository<LessonWatchEvent>,
    @InjectRepository(QuizAttempt)
    private readonly quizAttemptsRepository: Repository<QuizAttempt>,
  ) {}

  async getActiveEnrollmentsForCourse(courseId: string): Promise<Enrollment[]> {
    return this.enrollmentsRepository.find({
      where: { courseId, completedAt: IsNull() },
    });
  }

  async getAllActiveEnrollments(): Promise<Enrollment[]> {
    return this.enrollmentsRepository.find({
      where: { completedAt: IsNull() },
    });
  }

  async extractForLearnerCourse(
    learnerId: string,
    courseId: string,
    now = new Date(),
  ): Promise<LearnerRiskInput> {
    const enrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId, completedAt: IsNull() },
    });

    if (!enrollment) {
      throw new NotFoundException('Active enrollment not found');
    }

    const [events, progressRows, watchEvents, quizAttempts] = await Promise.all(
      [
        this.analyticsEventsRepository.find({ where: { learnerId, courseId } }),
        this.lessonProgressRepository.find({ where: { learnerId, courseId } }),
        this.lessonWatchEventsRepository.find({
          where: { learnerId, courseId },
        }),
        this.quizAttemptsRepository.find({
          where: { learnerId },
          relations: { quiz: { lesson: true } },
        }),
      ],
    );

    return {
      learnerId,
      courseId,
      enrollmentId: enrollment.id,
      features: this.toFeatures(
        enrollment,
        events,
        progressRows,
        watchEvents,
        quizAttempts,
        now,
      ),
    };
  }

  private toFeatures(
    enrollment: Enrollment,
    events: LearningAnalyticsEvent[],
    progressRows: LessonProgress[],
    watchEvents: LessonWatchEvent[],
    quizAttempts: QuizAttempt[],
    now: Date,
  ): RiskFeatures {
    const daysSinceEnrollment = Math.max(
      1,
      this.daysBetween(enrollment.enrolledAt, now),
    );
    const latestEventAt = events.reduce<Date | null>((latest, event) => {
      if (!latest || event.createdAt > latest) return event.createdAt;
      return latest;
    }, null);
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
    const courseQuizAttempts = quizAttempts.filter(
      (attempt) => attempt.quiz?.lesson?.courseId === enrollment.courseId,
    );
    const submittedAttempts = courseQuizAttempts.filter((attempt) =>
      [QuizAttemptStatus.PASSED, QuizAttemptStatus.NOT_PASSED].includes(
        attempt.status,
      ),
    );
    const scorePercentages = submittedAttempts
      .map((attempt) => {
        const total = Number(attempt.totalPoints) || 0;
        if (total <= 0) return null;
        return ((Number(attempt.score) || 0) / total) * 100;
      })
      .filter((value): value is number => value !== null);
    const expectedProgressPercent = Math.min(100, daysSinceEnrollment * 3);
    const courseProgressPercent = Number(enrollment.progress) || 0;

    return {
      lastActivityDays: latestEventAt
        ? this.daysBetween(latestEventAt, now)
        : daysSinceEnrollment,
      activityCount7d: events.filter((event) => event.createdAt >= sevenDaysAgo)
        .length,
      expectedProgressGap: Math.max(
        0,
        expectedProgressPercent - courseProgressPercent,
      ),
      courseProgressPercent,
      quizScoreAvgPercent: this.average(scorePercentages),
      quizPassRate: submittedAttempts.length
        ? submittedAttempts.filter((attempt) => attempt.passed).length /
          submittedAttempts.length
        : 0,
      watchRatioAvg: this.average(
        progressRows.map((row) => Number(row.watchRatio) || 0),
      ),
      abandonedAttemptCount: courseQuizAttempts.filter((attempt) =>
        [QuizAttemptStatus.ABANDONED, QuizAttemptStatus.IN_PROGRESS].includes(
          attempt.status,
        ),
      ).length,
      lateQuizCount: submittedAttempts.filter((attempt) => attempt.isLate)
        .length,
      completionVelocity:
        progressRows.filter((row) => row.lessonCompletedAt).length /
        daysSinceEnrollment,
      totalWatchedSeconds: progressRows.reduce(
        (total, row) => total + (Number(row.watchedSeconds) || 0),
        0,
      ),
      pauseCount: watchEvents.filter(
        (event) => event.eventType === LessonWatchEventType.PAUSED,
      ).length,
    };
  }

  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return (
      Math.round(
        (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
      ) / 100
    );
  }

  private daysBetween(start: Date, end: Date): number {
    return Math.max(
      0,
      Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY),
    );
  }
}
