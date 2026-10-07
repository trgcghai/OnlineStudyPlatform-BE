import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { Client } from 'minio';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import request from 'supertest';
import { App } from 'supertest/types';
import originalSource from '../src/database/data-source';
import { CreateCertificates1791158400000 } from '../src/database/migrations/1791158400000-create-certificates';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import {
  Course,
  CourseStatus,
} from '../src/modules/courses/entities/course.entity';
import { Enrollment } from '../src/modules/enrollments/entities/enrollment.entity';
import { Lesson } from '../src/modules/lessons/entities/lesson.entity';
import { LessonProgress } from '../src/modules/learning/entities/lesson-progress.entity';
import { CourseProgressService } from '../src/modules/learning/course-progress.service';
import { Quiz } from '../src/modules/quizzes/entities/quiz.entity';
import { QuizAttempt } from '../src/modules/quizzes/entities/quiz-attempt.entity';
import { QuizAttemptStatus } from '../src/modules/quizzes/dto/quiz-attempt.dto';
import { Certificate } from '../src/modules/certificates/entities/certificate.entity';
import { CertificateEligibilityService } from '../src/modules/certificates/certificate-eligibility.service';
import { CertificatePdfService } from '../src/modules/certificates/certificate-pdf.service';
import { CertificateStorageService } from '../src/modules/certificates/certificate-storage.service';
import { CertificatesService } from '../src/modules/certificates/certificates.service';
import {
  CertificatesController,
  CertificateVerificationController,
} from '../src/modules/certificates/certificates.controller';
import {
  CERTIFICATE_JOB,
  CertificateJobData,
} from '../src/modules/certificates/certificate.constants';
import { CertificateQueueService } from '../src/modules/certificates/certificate-queue.service';
import { CertificateProcessor } from '../src/modules/certificates/certificate-processor';

// Real PostgreSQL/Redis/MinIO, isolated from application rows, queues and buckets.
describe('Certificates (integration + HTTP e2e)', () => {
  jest.setTimeout(60_000);
  const suffix = randomUUID().replaceAll('-', '');
  const schema = `test_certificates_${suffix}`;
  const bucket = `test-certificates-${suffix}`;
  const jwt = new JwtService({ secret: 'isolated-certificate-e2e-secret' });
  let source: DataSource;
  let minio: Client;
  let app: INestApplication<App>;
  let service: CertificatesService;
  let storage: CertificateStorageService;
  let queue: Queue<CertificateJobData>;
  let events: QueueEvents;
  let worker: Worker<CertificateJobData>;
  let learner: User;
  let instructor: User;
  let course: Course;
  let lesson: Lesson;
  let quiz: Quiz;
  let certificate: Certificate;
  const auth = (id: string, role = UserRole.LEARNER) =>
    `Bearer ${jwt.sign({ id, role })}`;

  beforeAll(async () => {
    const rootEnv = parse(readFileSync(join(__dirname, '../../.env')));
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
    // Exercise the production migration, rather than relying on synchronize alone.
    await source.query(`DROP TABLE "${schema}"."certificates"`);
    const runner = source.createQueryRunner();
    try {
      await new CreateCertificates1791158400000().up(runner);
    } finally {
      await runner.release();
    }

    minio = new Client({
      endPoint: '127.0.0.1',
      port: 9000,
      useSSL: false,
      accessKey: rootEnv.MINIO_ROOT_USER,
      secretKey: rootEnv.MINIO_ROOT_PASSWORD,
    });
    const config = new ConfigService({
      MINIO_BUCKET: rootEnv.MINIO_BUCKET,
      CERTIFICATES_BUCKET: bucket,
    });
    storage = new CertificateStorageService(minio, config);
    await storage.onModuleInit();
    service = new CertificatesService(
      source.getRepository(Certificate),
      source,
      new CertificateEligibilityService(),
      new CertificatePdfService(),
      storage,
    );

    learner = await source.getRepository(User).save({
      name: 'Nguyễn Thị Ánh',
      email: `learner-${suffix}@example.test`,
      password: 'test-fixture',
      role: UserRole.LEARNER,
    });
    instructor = await source.getRepository(User).save({
      name: 'Giảng viên kiểm thử',
      email: `instructor-${suffix}@example.test`,
      password: 'test-fixture',
      role: UserRole.INSTRUCTOR,
    });
    course = await source.getRepository(Course).save({
      title: 'Lập trình căn bản',
      description: 'Fixture',
      category: 'CNTT',
      instructorId: instructor.id,
      status: CourseStatus.PUBLISHED,
    });
    lesson = await source.getRepository(Lesson).save({
      title: 'Bài học',
      courseId: course.id,
      duration: 100,
      position: 1,
    });
    quiz = await source
      .getRepository(Quiz)
      .save({ title: 'Quiz bắt buộc', lessonId: lesson.id });
    const enrollment = await source.getRepository(Enrollment).save({
      learnerId: learner.id,
      courseId: course.id,
      progress: '100',
      completedAt: new Date(),
    });
    await source.getRepository(LessonProgress).save({
      learnerId: learner.id,
      courseId: course.id,
      lessonId: lesson.id,
      enrollmentId: enrollment.id,
      watchCompletedAt: new Date(),
      lessonCompletedAt: new Date(),
      watchedSeconds: 100,
      watchRatio: '1.0',
    });

    const module = await Test.createTestingModule({
      controllers: [CertificatesController, CertificateVerificationController],
      providers: [
        { provide: CertificatesService, useValue: service },
        RolesGuard,
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
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    if (queue) {
      await queue.obliterate({ force: true });
      await queue.close();
    }
    await app?.close();
    if (source?.isInitialized) {
      const certificates = await source.getRepository(Certificate).find();
      for (const row of certificates) await storage.remove(row.objectKey);
      // Only the random schema created by this test may be dropped.
      if (!/^test_certificates_[a-f0-9]{32}$/u.test(schema))
        throw new Error('Unsafe test schema');
      await source.query(`DROP SCHEMA "${schema}" CASCADE`);
      await source.destroy();
    }
    if (minio && (await minio.bucketExists(bucket)))
      await minio.removeBucket(bucket);
  });

  it('refuses a failed or pending quiz even with stale 100% progress', async () => {
    const attempts = source.getRepository(QuizAttempt);
    await attempts.save({
      learnerId: learner.id,
      quizId: quiz.id,
      status: QuizAttemptStatus.NOT_PASSED,
      passed: false,
      submittedAt: new Date(),
    });
    expect(await service.issue(learner.id, course.id)).toBeNull();
    await attempts.save({
      learnerId: learner.id,
      quizId: quiz.id,
      status: QuizAttemptStatus.IN_PROGRESS,
      passed: false,
      submittedAt: new Date(),
      pendingEssayCount: 1,
    });
    expect(await service.issue(learner.id, course.id)).toBeNull();
    expect(await source.getRepository(Certificate).count()).toBe(0);
  });

  it('retries a real BullMQ job after a transient failure and issues after completion', async () => {
    await source.getRepository(QuizAttempt).save({
      learnerId: learner.id,
      quizId: quiz.id,
      status: QuizAttemptStatus.PASSED,
      passed: true,
      submittedAt: new Date(),
      score: '100',
      totalPoints: '100',
    });
    const connection = { host: '127.0.0.1', port: 6379 };
    const queueName = `test-certificates-${suffix}`;
    queue = new Queue(queueName, { connection });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
    const processor = new CertificateProcessor(service);
    let processed = 0;
    worker = new Worker(
      queueName,
      async (job) => {
        if (++processed === 1) throw new Error('transient test failure');
        await processor.process(job);
      },
      { connection },
    );
    const publisher = new CertificateQueueService(queue);
    const progress = new CourseProgressService(
      source.getRepository(Enrollment),
      source.getRepository(Lesson),
      source.getRepository(LessonProgress),
      source.getRepository(Quiz),
      source.getRepository(QuizAttempt),
      publisher,
    );
    await progress.recomputeEnrollmentProgress(learner.id, course.id);
    let job = await queue.getJob(`certificate-${learner.id}-${course.id}`);
    for (let check = 0; !job && check < 50; check++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await queue.getJob(`certificate-${learner.id}-${course.id}`);
    }
    expect(job?.name).toBe(CERTIFICATE_JOB);
    await job!.waitUntilFinished(events, 30_000);
    expect(processed).toBe(2);
    certificate = await source
      .getRepository(Certificate)
      .findOneByOrFail({ learnerId: learner.id, courseId: course.id });
  });

  it('serializes concurrent checks and the database rejects duplicate inserts', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.issue(learner.id, course.id)),
    );
    expect(new Set(results.map((row) => row?.id))).toEqual(
      new Set([certificate.id]),
    );
    expect(await source.getRepository(Certificate).count()).toBe(1);
    await expect(
      source.getRepository(Certificate).insert({
        ...certificate,
        id: randomUUID(),
        objectKey: `certificates/${randomUUID()}.pdf`,
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('lists certificates and downloads a real PDF attachment with protected storage', async () => {
    const list = await request(app.getHttpServer())
      .get('/learner/certificates')
      .set('Authorization', auth(learner.id))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].certificateUrl).toBe(certificate.certificateUrl);
    const response = await request(app.getHttpServer())
      .get(certificate.certificateUrl)
      .set('Authorization', auth(learner.id))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      })
      .expect(200)
      .expect('Content-Type', /application\/pdf/u)
      .expect('Content-Disposition', /attachment/u)
      .expect('Cache-Control', 'private, no-store');
    expect((response.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const publicResponse = await fetch(
      `http://127.0.0.1:9000/${bucket}/${certificate.objectKey}`,
    );
    expect(publicResponse.status).toBe(403);
  });

  it('enforces login, learner role, ownership and UUID validation', async () => {
    await request(app.getHttpServer())
      .get(certificate.certificateUrl)
      .expect(401);
    await request(app.getHttpServer())
      .get(certificate.certificateUrl)
      .set('Authorization', auth(instructor.id, UserRole.INSTRUCTOR))
      .expect(403);
    await request(app.getHttpServer())
      .get(certificate.certificateUrl)
      .set('Authorization', auth(randomUUID()))
      .expect(404);
    await request(app.getHttpServer())
      .get('/learner/certificates/not-a-uuid/download')
      .set('Authorization', auth(learner.id))
      .expect(400);
    await request(app.getHttpServer())
      .get('/learner/certificates')
      .set('Authorization', auth(randomUUID()))
      .expect(200)
      .expect((response) => expect(response.body.data).toEqual([]));
  });

  it('keeps issued names and bytes unchanged when names or curriculum change', async () => {
    const originalBytes = await buffer(
      await storage.download(certificate.objectKey),
    );
    await source.getRepository(User).update(learner.id, { name: 'Tên mới' });
    await source
      .getRepository(Course)
      .update(course.id, { title: 'Khóa học đổi tên' });
    await source.getRepository(Lesson).save({
      courseId: course.id,
      title: 'Bài học mới',
      duration: 100,
      position: 2,
    });
    const original = await service.issue(learner.id, course.id);
    expect(original?.id).toBe(certificate.id);
    expect(original?.issuedAt).toEqual(certificate.issuedAt);
    expect(await buffer(await storage.download(certificate.objectKey))).toEqual(
      originalBytes,
    );
    const verify = await request(app.getHttpServer())
      .get(`/certificates/${certificate.id}/verify`)
      .expect(200);
    expect(verify.body.data).toMatchObject({
      valid: true,
      learnerName: 'Nguyễn Thị Ánh',
      courseTitle: 'Lập trình căn bản',
    });
    expect(verify.body.data).not.toHaveProperty('learnerId');
    await request(app.getHttpServer())
      .get(`/certificates/${randomUUID()}/verify`)
      .expect(404);
  });
});
