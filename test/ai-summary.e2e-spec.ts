import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { LessonSummaryStatus } from '../src/modules/ai-summary/entities/lesson-summary.entity';
import { LearningController } from '../src/modules/learning/learning.controller';
import { LearningProgressService } from '../src/modules/learning/learning-progress.service';
import { LearningService } from '../src/modules/learning/learning.service';

describe('AI lesson summary (e2e)', () => {
  let app: INestApplication<App>;

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';
  const lessonId = '33333333-3333-4333-8333-333333333333';
  let summary = {
    lessonId,
    status: LessonSummaryStatus.PENDING,
    summaryText: null as string | null,
    updatedAt: null as Date | null,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LearningController],
      providers: [
        {
          provide: LearningService,
          useValue: {
            getLessonSummary: jest.fn().mockImplementation(() => summary),
          },
        },
        {
          provide: LearningProgressService,
          useValue: { recordWatchEvent: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = { id: learnerId };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets a learner observe pending then ready through the polling endpoint', async () => {
    const path = `/learning/courses/${courseId}/lessons/${lessonId}/summary`;

    await request(app.getHttpServer()).get(path).expect(200).expect({
      lessonId,
      status: LessonSummaryStatus.PENDING,
      summaryText: null,
      updatedAt: null,
    });

    summary = {
      lessonId,
      status: LessonSummaryStatus.READY,
      summaryText: 'Tóm tắt bài giảng đã sẵn sàng.',
      updatedAt: new Date('2026-09-26T00:00:00.000Z'),
    };

    await request(app.getHttpServer()).get(path).expect(200).expect({
      lessonId,
      status: LessonSummaryStatus.READY,
      summaryText: 'Tóm tắt bài giảng đã sẵn sàng.',
      updatedAt: '2026-09-26T00:00:00.000Z',
    });
  });
});
