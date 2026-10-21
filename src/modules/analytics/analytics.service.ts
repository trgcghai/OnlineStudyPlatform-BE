import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { LearningAnalyticsEvent } from '../learning/entities/learning-analytics-event.entity';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { CourseAnalyticsResponse } from './dto/course-analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Course) private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Enrollment) private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(LearningAnalyticsEvent) private readonly eventsRepository: Repository<LearningAnalyticsEvent>,
    @InjectRepository(QuizAttempt) private readonly attemptsRepository: Repository<QuizAttempt>,
  ) {}

  async getCourseAnalytics(courseId: string, instructorId: string, from: Date, to: Date): Promise<CourseAnalyticsResponse> {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
      throw new BadRequestException('Khoảng thời gian không hợp lệ');
    }

    const course = await this.coursesRepository.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Không tìm thấy khóa học');
    if (course.instructorId !== instructorId) throw new ForbiddenException('Bạn không có quyền xem khóa học này');

    const [progress, engagement, quiz] = await Promise.all([
      this.enrollmentsRepository.createQueryBuilder('enrollment')
        .select('COUNT(enrollment.id)', 'enrollmentCount')
        .addSelect('COALESCE(AVG(enrollment.progress), 0)', 'averageProgress')
        .addSelect('COUNT(enrollment.completedAt)', 'completedCount')
        .where('enrollment.courseId = :courseId', { courseId })
        .getRawOne(),
      this.eventsRepository.createQueryBuilder('event')
        .select('COUNT(DISTINCT event.learnerId)', 'activeLearnerCount')
        .addSelect('COUNT(event.id)', 'eventCount')
        .where('event.courseId = :courseId', { courseId })
        .andWhere('event.createdAt >= :from', { from })
        .andWhere('event.createdAt < :to', { to })
        .getRawOne(),
      this.attemptsRepository.createQueryBuilder('attempt')
        .innerJoin('attempt.quiz', 'quiz')
        .innerJoin('quiz.lesson', 'lesson')
        .select('COUNT(attempt.id)', 'gradedAttemptCount')
        .addSelect('AVG(attempt.score / attempt.totalPoints * 100)', 'averageScorePercent')
        .addSelect('COUNT(attempt.id) FILTER (WHERE attempt.passed = true)', 'passedCount')
        .where('lesson.courseId = :courseId', { courseId })
        .andWhere('attempt.submittedAt >= :from', { from })
        .andWhere('attempt.submittedAt < :to', { to })
        .andWhere('attempt.status IN (:...statuses)', { statuses: [QuizAttemptStatus.PASSED, QuizAttemptStatus.NOT_PASSED] })
        .andWhere('attempt.pendingEssayCount = 0')
        .andWhere('attempt.totalPoints > 0')
        .getRawOne(),
    ]);

    const enrollmentCount = Number(progress?.enrollmentCount ?? 0);
    const completedCount = Number(progress?.completedCount ?? 0);
    const activeLearnerCount = Number(engagement?.activeLearnerCount ?? 0);
    const gradedAttemptCount = Number(quiz?.gradedAttemptCount ?? 0);
    return {
      courseId,
      generatedAt: new Date().toISOString(),
      progress: {
        enrollmentCount,
        averageProgressPercent: Number(progress?.averageProgress ?? 0),
        completedEnrollmentCount: completedCount,
        completionRatePercent: enrollmentCount ? (completedCount / enrollmentCount) * 100 : 0,
      },
      engagement: {
        periodStart: from.toISOString(), periodEndExclusive: to.toISOString(), activeLearnerCount,
        eventCount: Number(engagement?.eventCount ?? 0),
        engagementScorePercent: enrollmentCount ? (activeLearnerCount / enrollmentCount) * 100 : 0,
      },
      quizPerformance: {
        gradedAttemptCount,
        averageScorePercent: gradedAttemptCount ? Number(quiz?.averageScorePercent) : null,
        passRatePercent: gradedAttemptCount ? (Number(quiz?.passedCount ?? 0) / gradedAttemptCount) * 100 : null,
      },
    };
  }
}
