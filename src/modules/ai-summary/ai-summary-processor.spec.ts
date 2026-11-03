import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';
import { AiSummaryClient } from './ai-summary.client';
import { AiSummaryProcessor } from './ai-summary-processor';
import { AiSummaryJobData } from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';
import { LessonAudioService } from './lesson-audio.service';

describe('AiSummaryProcessor', () => {
  let processor: AiSummaryProcessor;
  let lessonsRepository: { findOne: jest.Mock };
  let summariesRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let lessonAudioService: {
    extractStoredVideo: jest.Mock;
    removeAudioQuietly: jest.Mock;
  };
  let aiKnowledgeService: { enqueueTranscript: jest.Mock };
  let aiSummaryClient: { transcribe: jest.Mock; summarize: jest.Mock };

  const videoUrl = 'http://minio/bucket/video.mp4';
  const audioUrl = 'http://minio/bucket/summary-audio/audio.ogg';
  const makeLesson = (overrides: Partial<Lesson> = {}): Lesson =>
    ({
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Dependency Injection',
      videoUrl,
      ...overrides,
    }) as Lesson;
  const makeSummary = (overrides: Partial<LessonSummary> = {}): LessonSummary =>
    ({
      lessonId: 'lesson-1',
      audioUrl,
      summaryText: null,
      status: LessonSummaryStatus.PENDING,
      error: null,
      sourceVideoUrl: videoUrl,
      updatedAt: null,
      ...overrides,
    }) as LessonSummary;
  const makeJob = (overrides: Partial<Job<AiSummaryJobData>> = {}) =>
    ({
      data: { lessonId: 'lesson-1', videoUrl },
      attemptsMade: 0,
      opts: { attempts: 3 },
      ...overrides,
    }) as Job<AiSummaryJobData>;

  beforeEach(() => {
    lessonsRepository = { findOne: jest.fn() };
    summariesRepository = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    lessonAudioService = {
      extractStoredVideo: jest.fn().mockResolvedValue({
        objectKey: 'summary-audio/audio.ogg',
        url: audioUrl,
      }),
      removeAudioQuietly: jest.fn().mockResolvedValue(undefined),
    };
    aiKnowledgeService = {
      enqueueTranscript: jest.fn().mockResolvedValue(true),
    };
    aiSummaryClient = {
      transcribe: jest.fn().mockResolvedValue({
        transcript: 'Dependency Injection cung cap dependency.',
        language: 'vi',
        durationSeconds: 30,
      }),
      summarize: jest.fn().mockResolvedValue({
        summary: '## Tong quan\n\nDependency Injection.',
        provider: '9router',
      }),
    };
    processor = new AiSummaryProcessor(
      lessonsRepository as unknown as Repository<Lesson>,
      summariesRepository as unknown as Repository<LessonSummary>,
      lessonAudioService as unknown as LessonAudioService,
      aiKnowledgeService as unknown as AiKnowledgeService,
      aiSummaryClient as unknown as AiSummaryClient,
    );
  });

  it('runs transcribe then summarize then stores the ready summary', async () => {
    const entity = makeLesson();
    lessonsRepository.findOne.mockResolvedValue(entity);
    summariesRepository.findOne.mockResolvedValue(makeSummary());

    await processor.process(makeJob());

    expect(aiSummaryClient.transcribe).toHaveBeenCalledWith({
      lessonId: entity.id,
      audioUrl,
    });
    expect(summariesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: 'Dependency Injection cung cap dependency.',
        transcriptLanguage: 'vi',
        transcriptDurationSeconds: 30,
      }),
    );
    expect(aiKnowledgeService.enqueueTranscript).toHaveBeenCalledWith(
      entity.id,
      true,
    );
    expect(aiSummaryClient.summarize).toHaveBeenCalledWith({
      lessonId: entity.id,
      title: entity.title,
      transcript: 'Dependency Injection cung cap dependency.',
    });
    expect(summariesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        summaryText: '## Tong quan\n\nDependency Injection.',
        status: LessonSummaryStatus.READY,
      }),
    );
  });

  it('derives and stores audio before transcribing a legacy video', async () => {
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    summariesRepository.findOne.mockResolvedValue(makeSummary({ audioUrl: null }));

    await processor.process(makeJob());

    expect(lessonAudioService.extractStoredVideo).toHaveBeenCalledWith(
      videoUrl,
      'course-1',
      'lesson-1',
    );
    expect(aiSummaryClient.transcribe).toHaveBeenCalledWith({
      lessonId: 'lesson-1',
      audioUrl,
    });
  });

  it('does not overwrite a newer video source', async () => {
    lessonsRepository.findOne
      .mockResolvedValueOnce(makeLesson())
      .mockResolvedValueOnce(makeLesson({ videoUrl: 'new-video.mp4' }));
    summariesRepository.findOne.mockResolvedValue(makeSummary());

    await processor.process(makeJob());

    expect(summariesRepository.save).toHaveBeenCalledTimes(1);
  });

  it('leaves a transient failure retryable before the final attempt', async () => {
    const summary = makeSummary();
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    summariesRepository.findOne.mockResolvedValue(summary);
    aiSummaryClient.transcribe.mockRejectedValue(new Error('timeout'));

    await expect(processor.process(makeJob())).rejects.toThrow('timeout');
    expect(summary.status).toBe(LessonSummaryStatus.PROCESSING);
  });

  it('marks the active source failed on the final attempt and redacts URLs', async () => {
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    summariesRepository.findOne.mockResolvedValue(makeSummary());
    aiSummaryClient.transcribe.mockRejectedValue(
      new Error('http://secret-host failed'),
    );

    await expect(processor.process(makeJob({ attemptsMade: 2 }))).rejects.toThrow();
    expect(summariesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: LessonSummaryStatus.FAILED,
        error: '[redacted-url] failed',
      }),
    );
  });

  it('retains the transcript when summarization fails', async () => {
    const lesson = makeLesson();
    const summary = makeSummary();
    lessonsRepository.findOne.mockResolvedValue(lesson);
    summariesRepository.findOne.mockResolvedValue(summary);
    aiSummaryClient.transcribe.mockResolvedValue({
      transcript: 'Noi dung day du cua bai giang.',
      language: 'vi',
      durationSeconds: 42,
    });
    aiSummaryClient.summarize.mockRejectedValue(new Error('Gemini quota exhausted'));

    await expect(
      processor.process(makeJob({ attemptsMade: 2 })),
    ).rejects.toThrow('Gemini quota exhausted');

    expect(summary).toEqual(
      expect.objectContaining({
        transcriptText: 'Noi dung day du cua bai giang.',
        transcriptLanguage: 'vi',
        transcriptDurationSeconds: 42,
        status: LessonSummaryStatus.FAILED,
        error: 'Gemini quota exhausted',
      }),
    );
    expect(aiKnowledgeService.enqueueTranscript).toHaveBeenCalledWith(
      lesson.id,
      true,
    );
  });
});
