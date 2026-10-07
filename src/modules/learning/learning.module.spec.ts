import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  MINIO_CLIENT,
  MINIO_PUBLIC_S3_CLIENT,
  MINIO_S3_CLIENT,
} from '../../common/constants/file.constant';
import { AiKnowledgeModule } from '../ai-knowledge/ai-knowledge.module';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';
import { AiSummaryModule } from '../ai-summary/ai-summary.module';
import { AiSummaryService } from '../ai-summary/ai-summary.service';
import { LessonAudioService } from '../ai-summary/lesson-audio.service';
import { CertificateQueueService } from '../certificates/certificate-queue.service';
import { CertificateReconciliationService } from '../certificates/certificate-reconciliation.service';
import { CERTIFICATE_QUEUE } from '../certificates/certificate.constants';
import { CertificatesModule } from '../certificates/certificates.module';
import { ExcelService } from '../file/excel.service';
import { ZipService } from '../file/zip.service';
import { LessonsModule } from '../lessons/lessons.module';
import { LessonsService } from '../lessons/lessons.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsQueueService } from '../notifications/notifications-queue.service';
import { EssayGradingService } from '../quizzes/essay-grading.service';
import { LearnerQuizzesController } from '../quizzes/learner-quizzes.controller';
import { QuizAttemptsService } from '../quizzes/quiz-attempts.service';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { QuizzesService } from '../quizzes/quizzes.service';
import { RedisService } from '../redis/redis.service';
import { CourseProgressService } from './course-progress.service';
import { LearningAccessService } from './learning-access.service';
import { LearningProgressService } from './learning-progress.service';
import { LearningModule } from './learning.module';

// Compile the actual feature modules; replace only infrastructure and AI/notification
// integrations. Compilation resolves constructor dependencies without starting jobs.
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: jest.fn().mockReturnValue({}),
      },
    },
    {
      provide: ConfigService,
      useValue: new ConfigService({ MINIO_BUCKET: 'module-test-assets' }),
    },
    { provide: RedisService, useValue: {} },
    { provide: MINIO_CLIENT, useValue: {} },
    { provide: MINIO_S3_CLIENT, useValue: {} },
    { provide: MINIO_PUBLIC_S3_CLIENT, useValue: {} },
    ZipService,
    ExcelService,
  ],
  exports: [
    DataSource,
    ConfigService,
    RedisService,
    MINIO_CLIENT,
    MINIO_S3_CLIENT,
    MINIO_PUBLIC_S3_CLIENT,
    ZipService,
    ExcelService,
  ],
})
class TestInfrastructureModule {}

@Module({
  providers: [{ provide: NotificationsQueueService, useValue: {} }],
  exports: [NotificationsQueueService],
})
class TestNotificationsModule {}

@Module({
  providers: [
    { provide: AiSummaryService, useValue: {} },
    { provide: LessonAudioService, useValue: {} },
  ],
  exports: [AiSummaryService, LessonAudioService],
})
class TestAiSummaryModule {}

@Module({
  providers: [{ provide: AiKnowledgeService, useValue: {} }],
  exports: [AiKnowledgeService],
})
class TestAiKnowledgeModule {}

describe('Learning feature module wiring', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TestInfrastructureModule,
        BullModule.forRoot({ connection: { host: '127.0.0.1' } }),
        CertificatesModule,
        LearningModule,
        LessonsModule,
        QuizzesModule,
      ],
    })
      .overrideModule(NotificationsModule)
      .useModule(TestNotificationsModule)
      .overrideModule(AiSummaryModule)
      .useModule(TestAiSummaryModule)
      .overrideModule(AiKnowledgeModule)
      .useModule(TestAiKnowledgeModule)
      .overrideProvider(getQueueToken(CERTIFICATE_QUEUE))
      .useValue({ add: jest.fn(), close: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('shares one course progress service across learning, lessons and quizzes', () => {
    const progress = moduleRef
      .select(LearningModule)
      .get(CourseProgressService, { strict: true });
    const lessons = moduleRef.get(LessonsService);
    const quizzes = moduleRef.get(QuizzesService);
    const learning = moduleRef.get(LearningProgressService);

    expect(lessons.courseProgressService).toBe(progress);
    expect(quizzes.courseProgressService).toBe(progress);
    expect(learning.courseProgressService).toBe(progress);
  });

  it('shares learning progress and access with quiz attempts and essay grading', () => {
    const progress = moduleRef
      .select(LearningModule)
      .get(LearningProgressService, { strict: true });
    const access = moduleRef
      .select(LearningModule)
      .get(LearningAccessService, { strict: true });
    const attempts = moduleRef.get(QuizAttemptsService);
    const grading = moduleRef.get(EssayGradingService);

    expect(attempts.learningProgressService).toBe(progress);
    expect(attempts.learningAccessService).toBe(access);
    expect(grading.learningProgressService).toBe(progress);
    expect(attempts.notificationsQueueService).toBe(
      moduleRef.get(NotificationsQueueService),
    );
    expect(grading.notificationsQueueService).toBe(
      attempts.notificationsQueueService,
    );
  });

  it('shares the certificate queue between progress and reconciliation', () => {
    const queue = moduleRef
      .select(CertificatesModule)
      .get(CertificateQueueService, { strict: true });
    const progress = moduleRef.get(CourseProgressService);
    const reconciliation = moduleRef.get(CertificateReconciliationService);

    expect(progress.certificateQueue).toBe(queue);
    expect(reconciliation.queue).toBe(queue);
  });

  it('registers learner quiz routes only in QuizzesModule', () => {
    expect(
      moduleRef
        .select(QuizzesModule)
        .get(LearnerQuizzesController, { strict: true }),
    ).toBeInstanceOf(LearnerQuizzesController);

    expect(() =>
      moduleRef
        .select(LearningModule)
        .get(LearnerQuizzesController, { strict: true }),
    ).toThrow();
  });
});
