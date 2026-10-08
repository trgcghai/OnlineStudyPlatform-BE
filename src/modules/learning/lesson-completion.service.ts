import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { QuizAttemptStatus } from '../quizzes/dto/quiz-attempt.dto';
import { QuizAttempt } from '../quizzes/entities/quiz-attempt.entity';
import { Quiz } from '../quizzes/entities/quiz.entity';
import { RedisService } from '../redis/redis.service';
import { LearningWatchEventResponse } from './dto/learning.dto';
import { CourseProgressService } from './course-progress.service';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LearningService } from './learning.service';

@Injectable()
export class LessonCompletionService {
  constructor(
    private readonly learningService: LearningService,
    private readonly dataSource: DataSource,
    private readonly courseProgressService: CourseProgressService,
    private readonly redisService: RedisService,
  ) {}

  async completeLesson(
    learnerId: string,
    courseId: string,
    lessonId: string,
  ): Promise<LearningWatchEventResponse> {
    // Reuse enrollment, published-course and sequential-access checks.
    await this.learningService.getLessonLearning(learnerId, courseId, lessonId);

    const result = await this.dataSource.transaction(async (manager) => {
      // Serialize confirmations in the same enrollment, including different lessons.
      const enrollment = await manager.getRepository(Enrollment).findOne({
        where: { learnerId, courseId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!enrollment) {
        throw new ForbiddenException(
          'Bạn cần đăng ký khóa học để học nội dung này',
        );
      }

      const progress = await manager.getRepository(LessonProgress).findOne({
        where: { learnerId, courseId, lessonId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!progress) {
        throw new BadRequestException(
          'Bạn cần xem đủ video trước khi hoàn thành bài học.',
        );
      }

      if (!progress.lessonCompletedAt) {
        const lesson = await manager.getRepository(Lesson).findOne({
          where: { id: lessonId, courseId },
        });
        const course = await manager.getRepository(Course).findOne({
          where: { id: courseId },
        });
        if (!lesson || !course) throw new NotFoundException('Lesson not found');

        const threshold = Number(course.completionThresholdPercent ?? 90);
        if (lesson.duration <= 0) {
          throw new BadRequestException(
            'Thời lượng video chưa sẵn sàng. Vui lòng liên hệ giảng viên.',
          );
        }
        if (progress.watchedSeconds / lesson.duration < threshold / 100) {
          throw new BadRequestException(
            `Bạn cần xem ít nhất ${threshold}% video trước khi hoàn thành bài học.`,
          );
        }

        const quiz = await manager
          .getRepository(Quiz)
          .findOne({ where: { lessonId } });
        if (quiz) {
          const passedAttempts = await manager
            .getRepository(QuizAttempt)
            .count({
              where: {
                learnerId,
                quizId: quiz.id,
                passed: true,
                status: QuizAttemptStatus.PASSED,
                submittedAt: Not(IsNull()),
                pendingEssayCount: 0,
              },
            });
          if (passedAttempts === 0) {
            throw new BadRequestException(
              'Bạn cần đạt bài quiz và chờ chấm xong câu tự luận nếu có trước khi hoàn thành bài học.',
            );
          }
        }

        const completedAt = new Date();
        progress.watchCompletedAt ??= completedAt;
        progress.lessonCompletedAt = completedAt;
        // A confirmation never fabricates watch events or increases watched time.
        await manager.update(LessonProgress, progress.id, {
          watchCompletedAt: progress.watchCompletedAt,
          lessonCompletedAt: progress.lessonCompletedAt,
        });
        await manager.save(LearningAnalyticsEvent, {
          learnerId,
          courseId,
          lessonId,
          eventType: 'completed',
          payload: {
            source: 'manual_confirmation',
            watchRatio: Number(progress.watchRatio),
          },
          clientCreatedAt: null,
        });
      }

      // Recomputing also repairs a stale enrollment on a repeated confirmation.
      const updatedEnrollment =
        await this.courseProgressService.recomputeEnrollmentProgress(
          learnerId,
          courseId,
          manager,
        );
      return { progress, enrollment: updatedEnrollment };
    });

    // The worker can observe completion only after its transaction has committed.
    this.courseProgressService.queueCertificateIfComplete(result.enrollment);
    // Finish invalidation before the frontend refetches its saved completion.
    await this.redisService.invalidateNamespaces([
      'learning:course',
      'learning:lesson',
      'dashboard:learner',
    ]);
    return {
      lessonProgress: {
        lessonId,
        watchedSeconds: result.progress.watchedSeconds,
        lastPositionSeconds: result.progress.lastPositionSeconds,
        watchRatio: Number(result.progress.watchRatio),
        isWatchComplete: Boolean(result.progress.watchCompletedAt),
        isLessonComplete: Boolean(result.progress.lessonCompletedAt),
        completedAt: result.progress.lessonCompletedAt,
      },
      enrollment: {
        id: result.enrollment.id,
        progress: result.enrollment.progress,
        enrolledAt: result.enrollment.enrolledAt,
        completedAt: result.enrollment.completedAt,
      },
    };
  }
}
