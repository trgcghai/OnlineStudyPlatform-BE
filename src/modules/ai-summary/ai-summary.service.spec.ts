import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AI_SUMMARY_JOB } from './ai-summary.constants';
import { AiSummaryJobData } from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';
import { AiSummaryService } from './ai-summary.service';

describe('AiSummaryService', () => {
  let service: AiSummaryService;
  let lessonsRepository: { findOne: jest.Mock; find: jest.Mock };
  let summariesRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let queue: { add: jest.Mock };

  const lesson = (): Lesson =>
    ({
      id: 'lesson-1',
      courseId: 'course-1',
      position: 0,
      createdAt: new Date(),
      videoUrl: 'http://minio/bucket/video.mp4',
    }) as Lesson;

  const lessonSummary = (): LessonSummary =>
    ({
      lessonId: 'lesson-1',
      summaryText: 'Old summary',
      status: LessonSummaryStatus.READY,
      error: null,
      sourceVideoUrl: 'old-video.mp4',
      audioUrl: 'http://minio/bucket/audio.ogg',
      updatedAt: new Date(),
    }) as LessonSummary;

  beforeEach(() => {
    lessonsRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    summariesRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new AiSummaryService(
      lessonsRepository as unknown as Repository<Lesson>,
      summariesRepository as unknown as Repository<LessonSummary>,
      queue as unknown as Queue<AiSummaryJobData>,
      { get: jest.fn() } as unknown as ConfigService,
    );
  });

  it('clears stale output and enqueues a retryable per-video job', async () => {
    const entity = lesson();
    lessonsRepository.findOne.mockResolvedValue(entity);
    summariesRepository.findOne.mockResolvedValue(lessonSummary());

    await expect(service.enqueueLesson(entity.id)).resolves.toBe(true);

    expect(summariesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryText: null,
        status: LessonSummaryStatus.PENDING,
        sourceVideoUrl: entity.videoUrl,
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      AI_SUMMARY_JOB,
      { lessonId: entity.id, videoUrl: entity.videoUrl },
      expect.objectContaining({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      }),
    );
  });

  it('creates a summary row when the lesson has none', async () => {
    const entity = lesson();
    lessonsRepository.findOne.mockResolvedValue(entity);
    summariesRepository.findOne.mockResolvedValue(null);

    await service.enqueueLesson(entity.id);

    expect(summariesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: entity.id,
        audioUrl: null,
      }),
    );
  });

  it('marks the summary failed when Redis enqueue fails', async () => {
    const entity = lesson();
    lessonsRepository.findOne.mockResolvedValue(entity);
    summariesRepository.findOne.mockResolvedValue(lessonSummary());
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(service.enqueueLesson(entity.id)).rejects.toThrow(
      'redis down',
    );
    expect(summariesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: LessonSummaryStatus.FAILED }),
    );
  });

  it('enqueues every video lesson in a published course batch', async () => {
    lessonsRepository.find.mockResolvedValue([lesson(), lesson()]);
    summariesRepository.findOne.mockResolvedValue(lessonSummary());

    await expect(service.enqueueCourse('course-1')).resolves.toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
