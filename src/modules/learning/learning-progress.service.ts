import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Course, CourseStatus } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { LearningAccessService } from '../lessons/learning-access.service';
import { LearningWatchEventResponse } from './dto/learning.dto';
import { CreateWatchEventDto } from './dto/watch-event.dto';
import { LearningAnalyticsEvent } from './entities/learning-analytics-event.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { LessonWatchEvent } from './entities/lesson-watch-event.entity';

const LEARNING_ENROLLMENT_REQUIRED_MESSAGE =
  'Bạn cần đăng ký khóa học để học nội dung này';

@Injectable()
export class LearningProgressService {
  constructor(
    @InjectRepository(Course)
    private readonly coursesRepository: Repository<Course>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(Enrollment)
    private readonly enrollmentsRepository: Repository<Enrollment>,
    @InjectRepository(LessonProgress)
    private readonly progressRepository: Repository<LessonProgress>,
    @InjectRepository(LessonWatchEvent)
    private readonly watchEventsRepository: Repository<LessonWatchEvent>,
    @InjectRepository(LearningAnalyticsEvent)
    private readonly analyticsEventsRepository: Repository<LearningAnalyticsEvent>,
    private readonly learningAccessService: LearningAccessService,
  ) {}

  async recordWatchEvent(
    learnerId: string,
    courseId: string,
    lessonId: string,
    dto: CreateWatchEventDto,
  ): Promise<LearningWatchEventResponse> {
    const { course, enrollment, lesson, lessons } = await this.loadContext(
      learnerId,
      courseId,
      lessonId,
    );
    const completedLessonIds = await this.getCompletedLessonIds(
      learnerId,
      courseId,
    );
    const decision = this.learningAccessService.determineLessonAccess(
      course.learningOrder,
      lesson,
      lessons,
      completedLessonIds,
    );

    if (!decision.allowed) {
      throw new ForbiddenException(decision.message);
    }

    const existingEvent = await this.watchEventsRepository.findOne({
      where: { idempotencyKey: dto.idempotencyKey },
    });

    if (existingEvent) {
      const currentProgress = await this.findProgress(learnerId, lessonId);
      return this.toResponse(currentProgress, enrollment, lessonId);
    }

    const safePosition = this.clamp(dto.positionSeconds, lesson.duration);
    const safeWatched = this.clamp(dto.watchedSeconds, lesson.duration);
    const safeDuration = Math.max(0, dto.durationSeconds);
    const clientCreatedAt = dto.clientCreatedAt
      ? new Date(dto.clientCreatedAt)
      : null;

    await this.watchEventsRepository.save(
      this.watchEventsRepository.create({
        idempotencyKey: dto.idempotencyKey,
        learnerId,
        courseId,
        lessonId,
        eventType: dto.eventType,
        positionSeconds: safePosition,
        watchedSeconds: safeWatched,
        durationSeconds: safeDuration,
        clientCreatedAt,
      }),
    );

    const previousProgress = await this.findProgress(learnerId, lessonId);
    const wasComplete = Boolean(previousProgress?.lessonCompletedAt);
    const updatedProgress = await this.saveProgress({
      previousProgress,
      learnerId,
      courseId,
      lessonId,
      enrollmentId: enrollment.id,
      watchedSeconds: safeWatched,
      lastPositionSeconds: safePosition,
      durationSeconds: lesson.duration,
      thresholdPercent: Number(course.completionThresholdPercent ?? 90),
    });

    await this.analyticsEventsRepository.save(
      this.analyticsEventsRepository.create({
        learnerId,
        courseId,
        lessonId,
        eventType: dto.eventType,
        payload: {
          idempotencyKey: dto.idempotencyKey,
          positionSeconds: safePosition,
          watchedSeconds: safeWatched,
          durationSeconds: safeDuration,
          watchRatio: Number(updatedProgress.watchRatio),
        },
        clientCreatedAt,
      }),
    );

    if (!wasComplete && updatedProgress.lessonCompletedAt) {
      await this.recomputeEnrollmentProgress(enrollment, courseId, learnerId);
    }

    return this.toResponse(updatedProgress, enrollment, lessonId);
  }

  async getCompletedLessonIds(
    learnerId: string,
    courseId: string,
  ): Promise<ReadonlySet<string>> {
    const completed = await this.progressRepository.find({
      where: { learnerId, courseId },
    });

    return new Set(
      completed
        .filter((progress) => Boolean(progress.lessonCompletedAt))
        .map((progress) => progress.lessonId),
    );
  }

  private async loadContext(
    learnerId: string,
    courseId: string,
    lessonId: string,
  ) {
    const course = await this.coursesRepository.findOne({
      where: { id: courseId },
    });

    if (!course || course.status !== CourseStatus.PUBLISHED) {
      throw new NotFoundException('Course not found');
    }

    const enrollment = await this.enrollmentsRepository.findOne({
      where: { learnerId, courseId },
    });

    if (!enrollment) {
      throw new ForbiddenException(LEARNING_ENROLLMENT_REQUIRED_MESSAGE);
    }

    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId, courseId },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    const lessons = await this.lessonsRepository.find({
      where: { courseId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });

    return { course, enrollment, lesson, lessons };
  }

  private async findProgress(
    learnerId: string,
    lessonId: string,
  ): Promise<LessonProgress | null> {
    return this.progressRepository.findOne({ where: { learnerId, lessonId } });
  }

  private async saveProgress(input: {
    previousProgress: LessonProgress | null;
    learnerId: string;
    courseId: string;
    lessonId: string;
    enrollmentId: string;
    watchedSeconds: number;
    lastPositionSeconds: number;
    durationSeconds: number;
    thresholdPercent: number;
  }): Promise<LessonProgress> {
    const watchedSeconds = Math.max(
      input.previousProgress?.watchedSeconds ?? 0,
      input.watchedSeconds,
    );
    const lastPositionSeconds = Math.max(
      input.previousProgress?.lastPositionSeconds ?? 0,
      input.lastPositionSeconds,
    );
    const watchRatio =
      input.durationSeconds > 0 ? watchedSeconds / input.durationSeconds : 0;
    const isWatchComplete =
      input.durationSeconds > 0 && watchRatio >= input.thresholdPercent / 100;
    const isLessonComplete =
      isWatchComplete && this.areRequiredActivitiesComplete();
    const watchCompletedAt =
      input.previousProgress?.watchCompletedAt ??
      (isWatchComplete ? new Date() : null);
    const lessonCompletedAt =
      input.previousProgress?.lessonCompletedAt ??
      (isLessonComplete ? new Date() : null);

    const entity =
      input.previousProgress ??
      this.progressRepository.create({
        learnerId: input.learnerId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        enrollmentId: input.enrollmentId,
      });

    entity.watchedSeconds = watchedSeconds;
    entity.lastPositionSeconds = lastPositionSeconds;
    entity.watchRatio = watchRatio.toFixed(4);
    entity.watchCompletedAt = watchCompletedAt;
    entity.lessonCompletedAt = lessonCompletedAt;

    return this.progressRepository.save(entity);
  }

  private areRequiredActivitiesComplete(): boolean {
    return true;
  }

  private async recomputeEnrollmentProgress(
    enrollment: Enrollment,
    courseId: string,
    learnerId: string,
  ): Promise<void> {
    const totalLessons = await this.lessonsRepository.count({
      where: { courseId },
    });
    const completedLessons = await this.progressRepository.count({
      where: {
        learnerId,
        courseId,
        lessonCompletedAt: Not(IsNull()),
      },
    });
    const progress =
      totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;

    enrollment.progress = progress.toFixed(2);
    enrollment.completedAt =
      progress >= 100 ? (enrollment.completedAt ?? new Date()) : null;
    await this.enrollmentsRepository.save(enrollment);
  }

  private clamp(value: number, max: number): number {
    return Math.min(Math.max(0, value), Math.max(0, max));
  }

  private toResponse(
    progress: LessonProgress | null,
    enrollment: Enrollment,
    lessonId: string,
  ): LearningWatchEventResponse {
    return {
      lessonProgress: {
        lessonId: progress?.lessonId ?? lessonId,
        watchedSeconds: progress?.watchedSeconds ?? 0,
        lastPositionSeconds: progress?.lastPositionSeconds ?? 0,
        watchRatio: Number(progress?.watchRatio ?? 0),
        isWatchComplete: Boolean(progress?.watchCompletedAt),
        isLessonComplete: Boolean(progress?.lessonCompletedAt),
        completedAt: progress?.lessonCompletedAt ?? null,
      },
      enrollment: {
        id: enrollment.id,
        progress: enrollment.progress,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
      },
    };
  }
}
