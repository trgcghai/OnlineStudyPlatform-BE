import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AI_KNOWLEDGE_INDEX_JOB } from './ai-knowledge.constants';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiKnowledgeJobData } from './dto/ai-knowledge.dto';
import {
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  LessonKnowledgeSource,
} from './entities/lesson-knowledge-source.entity';

describe('AiKnowledgeService', () => {
  const lesson = {
    id: 'lesson-1',
    courseId: 'course-1',
    materialUrl: 'http://minio/bucket/lesson.pdf',
  } as Lesson;
  let lessonsRepository: { findOne: jest.Mock; find: jest.Mock };
  let summariesRepository: { findOne: jest.Mock };
  let sourcesRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let queue: { add: jest.Mock };
  let service: AiKnowledgeService;

  beforeEach(() => {
    lessonsRepository = {
      findOne: jest.fn().mockResolvedValue(lesson),
      find: jest.fn().mockResolvedValue([]),
    };
    summariesRepository = {
      findOne: jest.fn().mockResolvedValue({
        lessonId: lesson.id,
        transcriptText: 'Nội dung transcript đầy đủ.',
      }),
    };
    sourcesRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => value),
      save: jest.fn((value) =>
        Promise.resolve({ id: value.id ?? 'source-1', ...value }),
      ),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new AiKnowledgeService(
      lessonsRepository as unknown as Repository<Lesson>,
      summariesRepository as unknown as Repository<LessonSummary>,
      sourcesRepository as unknown as Repository<LessonKnowledgeSource>,
      queue as unknown as Queue<AiKnowledgeJobData>,
      { get: jest.fn() } as unknown as ConfigService,
    );
  });

  it('creates a pending material source and queues a hash-versioned job', async () => {
    await expect(service.enqueueMaterial(lesson.id)).resolves.toBe(true);

    expect(sourcesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: lesson.id,
        courseId: lesson.courseId,
        sourceType: KnowledgeSourceType.MATERIAL,
        sourceUrl: lesson.materialUrl,
        status: KnowledgeSourceStatus.PENDING,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      AI_KNOWLEDGE_INDEX_JOB,
      expect.objectContaining({ action: 'index', sourceId: 'source-1' }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('queues a transcript without storing it in Redis job data', async () => {
    await service.enqueueTranscript(lesson.id);

    const jobData = queue.add.mock.calls[0][1];
    expect(jobData).toEqual(
      expect.objectContaining({ action: 'index', sourceId: 'source-1' }),
    );
    expect(jobData).not.toHaveProperty('transcript');
  });

  it('skips an unchanged ready source unless forced', async () => {
    const contentHash = (
      service as unknown as { hash(value: string): string }
    ).hash(lesson.materialUrl!);
    sourcesRepository.findOne.mockResolvedValue({
      id: 'source-1',
      status: KnowledgeSourceStatus.READY,
      contentHash,
    });

    await expect(service.enqueueMaterial(lesson.id)).resolves.toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
