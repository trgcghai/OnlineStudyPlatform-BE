import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiKnowledgeGatewayService } from './ai-knowledge-gateway.service';
import { AiKnowledgeProcessor } from './ai-knowledge-processor';
import { AiKnowledgeJobData } from './dto/ai-knowledge.dto';
import {
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  LessonKnowledgeSource,
} from './entities/lesson-knowledge-source.entity';

describe('AiKnowledgeProcessor', () => {
  const source = {
    id: 'source-1',
    courseId: 'course-1',
    lessonId: 'lesson-1',
    sourceType: KnowledgeSourceType.TRANSCRIPT,
    sourceUrl: null,
    contentHash: 'a'.repeat(64),
    status: KnowledgeSourceStatus.PENDING,
    chunkCount: 0,
    error: null,
    indexedAt: null,
  } as LessonKnowledgeSource;
  let sourcesRepository: { findOne: jest.Mock; save: jest.Mock };
  let lessonsRepository: { findOne: jest.Mock };
  let summariesRepository: { findOne: jest.Mock };
  let gateway: {
    index: jest.Mock;
    deleteSource: jest.Mock;
    deleteCourse: jest.Mock;
  };
  let processor: AiKnowledgeProcessor;

  beforeEach(() => {
    sourcesRepository = {
      findOne: jest.fn().mockResolvedValue({ ...source }),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    lessonsRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'lesson-1',
        title: 'Dependency Injection',
      }),
    };
    summariesRepository = {
      findOne: jest.fn().mockResolvedValue({
        transcriptText: 'Nội dung transcript.',
      }),
    };
    gateway = {
      index: jest.fn().mockResolvedValue({
        sourceId: source.id,
        contentHash: source.contentHash,
        chunkCount: 4,
      }),
      deleteSource: jest.fn().mockResolvedValue(undefined),
      deleteCourse: jest.fn().mockResolvedValue(undefined),
    };
    processor = new AiKnowledgeProcessor(
      sourcesRepository as unknown as Repository<LessonKnowledgeSource>,
      lessonsRepository as unknown as Repository<Lesson>,
      summariesRepository as unknown as Repository<LessonSummary>,
      gateway as unknown as AiKnowledgeGatewayService,
    );
  });

  it('loads transcript from PostgreSQL and marks the current hash ready', async () => {
    await processor.process({
      data: {
        action: 'index',
        sourceId: source.id,
        contentHash: source.contentHash,
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Job<AiKnowledgeJobData>);

    expect(gateway.index).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: source.courseId,
        lessonId: source.lessonId,
        transcript: 'Nội dung transcript.',
      }),
    );
    expect(sourcesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: KnowledgeSourceStatus.READY,
        chunkCount: 4,
        indexedAt: expect.any(Date),
      }),
    );
  });

  it('ignores a stale hash before calling AI', async () => {
    await processor.process({
      data: {
        action: 'index',
        sourceId: source.id,
        contentHash: 'b'.repeat(64),
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Job<AiKnowledgeJobData>);

    expect(gateway.index).not.toHaveBeenCalled();
  });

  it('routes source deletion to the AI vector gateway', async () => {
    await processor.process({
      data: { action: 'delete-source', sourceId: source.id },
    } as Job<AiKnowledgeJobData>);

    expect(gateway.deleteSource).toHaveBeenCalledWith(source.id);
  });
});
