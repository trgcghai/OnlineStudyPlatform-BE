import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { AnalyticsService } from './analytics.service';

type AggregateBuilder = {
  select: jest.Mock; addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock;
  leftJoin: jest.Mock; innerJoin: jest.Mock; getRawOne: jest.Mock;
};

const builder = (result: Record<string, string>) => {
  const query: AggregateBuilder = {
    select: jest.fn(), addSelect: jest.fn(), where: jest.fn(), andWhere: jest.fn(),
    leftJoin: jest.fn(), innerJoin: jest.fn(), getRawOne: jest.fn().mockResolvedValue(result),
  };
  Object.values(query).forEach((method) => {
    if (typeof method === 'function' && method !== query.getRawOne) method.mockReturnValue(query);
  });
  return query;
};

describe('AnalyticsService', () => {
  const courseId = 'course-1';
  const instructorId = 'instructor-1';
  const from = new Date('2026-10-01T00:00:00.000Z');
  const to = new Date('2026-10-08T00:00:00.000Z');
  let courses: jest.Mocked<Pick<Repository<Course>, 'findOne'>>;
  let enrollments: jest.Mocked<Pick<Repository<Enrollment>, 'createQueryBuilder'>>;
  let events: jest.Mocked<Pick<Repository<LearningAnalyticsEvent>, 'createQueryBuilder'>>;
  let attempts: jest.Mocked<Pick<Repository<QuizAttempt>, 'createQueryBuilder'>>;
  let enrollmentQuery: AggregateBuilder;
  let eventQuery: AggregateBuilder;
  let attemptQuery: AggregateBuilder;
  let service: AnalyticsService;

  beforeEach(() => {
    courses = { findOne: jest.fn().mockResolvedValue({ id: courseId, instructorId }) };
    enrollmentQuery = builder({ enrollmentCount: '4', averageProgress: '62.50', completedCount: '1' });
    eventQuery = builder({ activeLearnerCount: '2', eventCount: '9' });
    attemptQuery = builder({ gradedAttemptCount: '2', averageScorePercent: '75', passedCount: '1' });
    enrollments = { createQueryBuilder: jest.fn().mockReturnValue(enrollmentQuery) };
    events = { createQueryBuilder: jest.fn().mockReturnValue(eventQuery) };
    attempts = { createQueryBuilder: jest.fn().mockReturnValue(attemptQuery) };
    service = new AnalyticsService(
      courses as unknown as Repository<Course>,
      enrollments as unknown as Repository<Enrollment>,
      events as unknown as Repository<LearningAnalyticsEvent>,
      attempts as unknown as Repository<QuizAttempt>,
    );
  });

  it('combines current enrollment snapshots with ranged engagement and graded quiz aggregates', async () => {
    await expect(service.getCourseAnalytics(courseId, instructorId, from, to)).resolves.toMatchObject({
      courseId,
      progress: { enrollmentCount: 4, averageProgressPercent: 62.5, completedEnrollmentCount: 1, completionRatePercent: 25 },
      engagement: { periodStart: from.toISOString(), periodEndExclusive: to.toISOString(), activeLearnerCount: 2, eventCount: 9, engagementScorePercent: 50 },
      quizPerformance: { gradedAttemptCount: 2, averageScorePercent: 75, passRatePercent: 50 },
    });
    expect(eventQuery.andWhere).toHaveBeenCalledWith('event.createdAt >= :from', { from });
    expect(eventQuery.andWhere).toHaveBeenCalledWith('event.createdAt < :to', { to });
    expect(attemptQuery.andWhere).toHaveBeenCalledWith('attempt.submittedAt >= :from', { from });
    expect(attemptQuery.andWhere).toHaveBeenCalledWith('attempt.submittedAt < :to', { to });
    expect(attemptQuery.andWhere).toHaveBeenCalledWith('attempt.pendingEssayCount = 0');
    expect(enrollmentQuery.andWhere).not.toHaveBeenCalled();
  });

  it('returns zero snapshots and null quiz percentages for empty denominators', async () => {
    enrollmentQuery.getRawOne.mockResolvedValue({ enrollmentCount: '0', averageProgress: null, completedCount: '0' });
    eventQuery.getRawOne.mockResolvedValue({ activeLearnerCount: '0', eventCount: '0' });
    attemptQuery.getRawOne.mockResolvedValue({ gradedAttemptCount: '0', averageScorePercent: null, passedCount: '0' });
    await expect(service.getCourseAnalytics(courseId, instructorId, from, to)).resolves.toMatchObject({
      progress: { enrollmentCount: 0, averageProgressPercent: 0, completionRatePercent: 0 },
      engagement: { activeLearnerCount: 0, eventCount: 0, engagementScorePercent: 0 },
      quizPerformance: { gradedAttemptCount: 0, averageScorePercent: null, passRatePercent: null },
    });
  });

  it('rejects an invalid range before running aggregates', async () => {
    await expect(service.getCourseAnalytics(courseId, instructorId, to, from)).rejects.toBeInstanceOf(BadRequestException);
    expect(enrollments.createQueryBuilder).not.toHaveBeenCalled();
    expect(events.createQueryBuilder).not.toHaveBeenCalled();
    expect(attempts.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('checks course existence and ownership before running aggregates', async () => {
    courses.findOne.mockResolvedValue(null);
    await expect(service.getCourseAnalytics(courseId, instructorId, from, to)).rejects.toBeInstanceOf(NotFoundException);
    courses.findOne.mockResolvedValue({ id: courseId, instructorId: 'other-instructor' } as Course);
    await expect(service.getCourseAnalytics(courseId, instructorId, from, to)).rejects.toBeInstanceOf(ForbiddenException);
    expect(enrollments.createQueryBuilder).not.toHaveBeenCalled();
    expect(events.createQueryBuilder).not.toHaveBeenCalled();
    expect(attempts.createQueryBuilder).not.toHaveBeenCalled();
  });
});
