import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import originalSource from '../src/database/data-source';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import {
  Course,
  CourseLearningOrder,
  CourseStatus,
} from '../src/modules/courses/entities/course.entity';
import { Enrollment } from '../src/modules/enrollments/entities/enrollment.entity';
import { Lesson } from '../src/modules/lessons/entities/lesson.entity';
import { LessonSummary } from '../src/modules/ai-summary/entities/lesson-summary.entity';
import { LearningAccessService } from '../src/modules/learning/learning-access.service';
import { CourseProgressService } from '../src/modules/learning/course-progress.service';
import { LearningProgressService } from '../src/modules/learning/learning-progress.service';
import { LearningService } from '../src/modules/learning/learning.service';
import { LearningController } from '../src/modules/learning/learning.controller';
import { LessonCompletionService } from '../src/modules/learning/lesson-completion.service';
import { LessonProgress } from '../src/modules/learning/entities/lesson-progress.entity';
import { LessonWatchEvent } from '../src/modules/learning/entities/lesson-watch-event.entity';
import { LearningAnalyticsEvent } from '../src/modules/learning/entities/learning-analytics-event.entity';
import { Quiz } from '../src/modules/quizzes/entities/quiz.entity';
import { QuizAttempt } from '../src/modules/quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../src/modules/quizzes/dto/quiz-attempt.dto';
import { CertificateQueueService } from '../src/modules/certificates/certificate-queue.service';
import { RedisService } from '../src/modules/redis/redis.service';

// Actual transactions and authorization against an isolated PostgreSQL schema.
describe('Lesson completion (PostgreSQL + HTTP)', () => {
  jest.setTimeout(60_000);
  const schema = `test_lesson_completion_${randomUUID().replaceAll('-', '')}`;
  const jwt = new JwtService({ secret: 'isolated-lesson-completion-secret' });
  const certificateQueue = {
    enqueueCompletion: jest.fn().mockResolvedValue(undefined),
  };
  const redisService = {
    invalidateNamespaces: jest.fn().mockResolvedValue(undefined),
  };
  let source: DataSource;
  let app: INestApplication<App>;
  let learner: User;
  let instructor: User;
  let course: Course;
  let lesson: Lesson;
  let secondLesson: Lesson;
  let enrollment: Enrollment;
  let progress: LessonProgress;
  const auth = (user: User) =>
    `Bearer ${jwt.sign({ id: user.id, role: user.role })}`;
  const endpoint = () =>
    `/learning/courses/${course.id}/lessons/${lesson.id}/complete`;

  beforeAll(async () => {
    source = new DataSource({
      ...originalSource.options,
      schema,
      synchronize: false,
      migrations: [],
      extra: { options: `-c search_path=${schema},public` },
    });
    await source.initialize();
    await source.query(`CREATE SCHEMA "${schema}"`);
    await source.synchronize();
    const entities = [
      Course,
      Enrollment,
      Lesson,
      LessonSummary,
      LessonProgress,
      LessonWatchEvent,
      LearningAnalyticsEvent,
      Quiz,
      QuizAttempt,
    ];
    const module = await Test.createTestingModule({
      controllers: [LearningController],
      providers: [
        LearningService,
        LearningProgressService,
        LessonCompletionService,
        CourseProgressService,
        LearningAccessService,
        RolesGuard,
        { provide: DataSource, useValue: source },
        { provide: CertificateQueueService, useValue: certificateQueue },
        { provide: RedisService, useValue: redisService },
        ...entities.map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: source.getRepository(entity),
        })),
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{
            headers: { authorization?: string };
            user?: unknown;
          }>();
          try {
            req.user = jwt.verify(
              req.headers.authorization?.replace(/^Bearer /u, '') ?? '',
            );
            return true;
          } catch {
            throw new UnauthorizedException();
          }
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(async () => {
    certificateQueue.enqueueCompletion.mockClear();
    learner = await source.getRepository(User).save({
      name: 'Learner',
      email: `${randomUUID()}@example.test`,
      password: 'fixture',
      role: UserRole.LEARNER,
    });
    instructor = await source.getRepository(User).save({
      name: 'Instructor',
      email: `${randomUUID()}@example.test`,
      password: 'fixture',
      role: UserRole.INSTRUCTOR,
    });
    course = await source.getRepository(Course).save({
      title: 'Course',
      description: 'Fixture',
      category: 'Testing',
      instructorId: instructor.id,
      status: CourseStatus.PUBLISHED,
      learningOrder: CourseLearningOrder.FREE,
      completionThresholdPercent: '90.00',
    });
    lesson = await source.getRepository(Lesson).save({
      title: 'Lesson 1',
      courseId: course.id,
      duration: 600,
      position: 0,
    });
    secondLesson = await source.getRepository(Lesson).save({
      title: 'Lesson 2',
      courseId: course.id,
      duration: 600,
      position: 1,
    });
    enrollment = await source
      .getRepository(Enrollment)
      .save({ learnerId: learner.id, courseId: course.id, progress: '0.00' });
    progress = await source.getRepository(LessonProgress).save({
      learnerId: learner.id,
      courseId: course.id,
      lessonId: lesson.id,
      enrollmentId: enrollment.id,
      watchedSeconds: 540,
      lastPositionSeconds: 545,
      watchRatio: '0.9000',
      watchCompletedAt: new Date(),
    });
  });

  afterAll(async () => {
    await app?.close();
    if (source?.isInitialized) {
      if (!/^test_lesson_completion_[a-f0-9]{32}$/u.test(schema))
        throw new Error('Unexpected test schema');
      await source.query(`DROP SCHEMA "${schema}" CASCADE`);
      await source.destroy();
    }
  });

  it('persists completion, returns 50 percent and retains it when the lesson is loaded again', async () => {
    const response = await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(learner))
      .expect(200);
    expect(response.body.data.lessonProgress.isLessonComplete).toBe(true);
    expect(response.body.data.enrollment.progress).toBe('50.00');
    const saved = await source
      .getRepository(LessonProgress)
      .findOneByOrFail({ id: progress.id });
    expect(saved.lessonCompletedAt).toBeInstanceOf(Date);
    expect(saved.watchedSeconds).toBe(540);
    expect(saved.lastPositionSeconds).toBe(545);
    expect(await source.getRepository(LessonWatchEvent).count()).toBe(0);
    const reload = await request(app.getHttpServer())
      .get(`/learning/courses/${course.id}/lessons/${lesson.id}`)
      .set('Authorization', auth(learner))
      .expect(200);
    expect(reload.body.data.isCompleted).toBe(true);
  });

  it('serializes concurrent clicks without duplicate events and queues certificates after full completion', async () => {
    await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app.getHttpServer())
          .post(endpoint())
          .set('Authorization', auth(learner))
          .expect(200),
      ),
    );
    expect(
      await source.getRepository(LearningAnalyticsEvent).count({
        where: {
          learnerId: learner.id,
          lessonId: lesson.id,
          eventType: 'completed',
        },
      }),
    ).toBe(1);
    expect(certificateQueue.enqueueCompletion).not.toHaveBeenCalled();
    await source.getRepository(LessonProgress).save({
      learnerId: learner.id,
      courseId: course.id,
      lessonId: secondLesson.id,
      enrollmentId: enrollment.id,
      watchedSeconds: 600,
      lastPositionSeconds: 600,
      watchRatio: '1.0000',
      watchCompletedAt: new Date(),
    });
    await request(app.getHttpServer())
      .post(
        `/learning/courses/${course.id}/lessons/${secondLesson.id}/complete`,
      )
      .set('Authorization', auth(learner))
      .expect(200);
    const saved = await source
      .getRepository(Enrollment)
      .findOneByOrFail({ id: enrollment.id });
    expect(saved.progress).toBe('100.00');
    expect(saved.completedAt).toBeInstanceOf(Date);
    expect(certificateQueue.enqueueCompletion).toHaveBeenCalledWith(
      learner.id,
      course.id,
    );
  });

  it('rejects insufficient watching without writing completion or course progress', async () => {
    await source
      .getRepository(LessonProgress)
      .update(progress.id, { watchedSeconds: 539 });
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(learner))
      .expect(400);
    expect(
      (
        await source
          .getRepository(LessonProgress)
          .findOneByOrFail({ id: progress.id })
      ).lessonCompletedAt,
    ).toBeNull();
    expect(
      (
        await source
          .getRepository(Enrollment)
          .findOneByOrFail({ id: enrollment.id })
      ).progress,
    ).toBe('0.00');
  });

  it('keeps pending essays incomplete and permits a fully graded passed quiz', async () => {
    const quiz = await source
      .getRepository(Quiz)
      .save({ title: 'Required quiz', lessonId: lesson.id });
    const attempt = await source.getRepository(QuizAttempt).save({
      learnerId: learner.id,
      quizId: quiz.id,
      passed: true,
      status: QuizAttemptStatus.PASSED,
      submittedAt: new Date(),
      pendingEssayCount: 1,
    });
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(learner))
      .expect(400);
    await source
      .getRepository(QuizAttempt)
      .update(attempt.id, { pendingEssayCount: 0 });
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(learner))
      .expect(200);
  });

  it('enforces JWT, learner role, UUID validation and lesson ownership', async () => {
    await request(app.getHttpServer()).post(endpoint()).expect(401);
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(instructor))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/learning/courses/${course.id}/lessons/invalid/complete`)
      .set('Authorization', auth(learner))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/learning/courses/${course.id}/lessons/${randomUUID()}/complete`)
      .set('Authorization', auth(learner))
      .expect(404);
    await source.getRepository(Enrollment).delete(enrollment.id);
    await request(app.getHttpServer())
      .post(endpoint())
      .set('Authorization', auth(learner))
      .expect(403);
  });

  it('does not allow the button to bypass a locked sequential lesson', async () => {
    await source
      .getRepository(Course)
      .update(course.id, { learningOrder: CourseLearningOrder.SEQUENTIAL });
    await request(app.getHttpServer())
      .post(
        `/learning/courses/${course.id}/lessons/${secondLesson.id}/complete`,
      )
      .set('Authorization', auth(learner))
      .expect(403);
  });

  it('rolls back lesson and activity writes if enrollment recomputation fails', async () => {
    const spy = jest
      .spyOn(app.get(CourseProgressService), 'recomputeEnrollmentProgress')
      .mockRejectedValueOnce(new Error('Simulated DB failure'));
    try {
      await expect(
        app
          .get(LessonCompletionService)
          .completeLesson(learner.id, course.id, lesson.id),
      ).rejects.toThrow('Simulated DB failure');
      expect(
        (
          await source
            .getRepository(LessonProgress)
            .findOneByOrFail({ id: progress.id })
        ).lessonCompletedAt,
      ).toBeNull();
      expect(
        await source
          .getRepository(LearningAnalyticsEvent)
          .count({ where: { learnerId: learner.id } }),
      ).toBe(0);
      expect(certificateQueue.enqueueCompletion).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
