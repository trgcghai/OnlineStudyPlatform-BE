import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiSummaryProcessor } from './ai-summary-processor';
import { AiSummaryJobData } from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';
import { LessonAudioService } from './lesson-audio.service';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';

describe('AiSummaryProcessor', () => {
  let processor: AiSummaryProcessor;
  let lessonsRepository: { findOne: jest.Mock };
  let summariesRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let lessonAudioService: {
    extractStoredVideo: jest.Mock;
    removeAudioQuietly: jest.Mock;
  };
  let aiKnowledgeService: { enqueueTranscript: jest.Mock };
  const originalFetch = global.fetch;

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
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'AI_URL') return 'http://ai:8000/';
        if (key === 'AI_TOKEN') return 'secret';
        return undefined;
      }),
    };
    global.fetch = jest.fn().mockImplementation((input: string | URL) => {
      const url = input.toString();
      return Promise.resolve({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(
          url.endsWith('/transcribe')
            ? {
                transcript: 'Dependency Injection cung cap dependency.',
                language: 'vi',
                durationSeconds: 30,
              }
            : {
                summary: '## Tong quan\n\nDependency Injection.',
                provider: 'gemini',
              },
        ),
      });
    });
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
    processor = new AiSummaryProcessor(
      lessonsRepository as unknown as Repository<Lesson>,
      summariesRepository as unknown as Repository<LessonSummary>,
      configService as unknown as ConfigService,
      lessonAudioService as unknown as LessonAudioService,
      aiKnowledgeService as unknown as AiKnowledgeService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('runs transcribe then summarize then stores the ready summary', async () => {
    const entity = makeLesson();
    lessonsRepository.findOne.mockResolvedValue(entity);
    summariesRepository.findOne.mockResolvedValue(makeSummary());

    await processor.process(makeJob());

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://ai:8000/transcribe',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: JSON.stringify({ lessonId: entity.id, audioUrl }),
      }),
    );
    expect(summariesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptText: 'Dependency Injection cung cap dependency.',
        transcriptLanguage: 'vi',
        transcriptDurationSeconds: 30,
        transcribedAt: expect.any(Date),
      }),
    );
    expect(aiKnowledgeService.enqueueTranscript).toHaveBeenCalledWith(
      entity.id,
      true,
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://ai:8000/summarize',
      expect.objectContaining({
        body: JSON.stringify({
          lessonId: entity.id,
          title: entity.title,
          transcript: 'Dependency Injection cung cap dependency.',
        }),
      }),
    );
    expect(summariesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        summaryText: '## Tong quan\n\nDependency Injection.',
        status: LessonSummaryStatus.READY,
        error: null,
      }),
    );
  });

  it('derives and stores audio before transcribing a legacy video', async () => {
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    summariesRepository.findOne.mockResolvedValue(
      makeSummary({ audioUrl: null }),
    );

    await processor.process(makeJob());

    expect(lessonAudioService.extractStoredVideo).toHaveBeenCalledWith(
      videoUrl,
      'course-1',
      'lesson-1',
    );
    expect(summariesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai:8000/transcribe',
      expect.objectContaining({
        body: JSON.stringify({ lessonId: 'lesson-1', audioUrl }),
      }),
    );
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
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    await expect(processor.process(makeJob())).rejects.toThrow(
      'AI summary service is unavailable',
    );
    expect(summary.status).toBe(LessonSummaryStatus.PROCESSING);
  });

  it('marks the active source failed on the final attempt', async () => {
    lessonsRepository.findOne.mockResolvedValue(makeLesson());
    summariesRepository.findOne.mockResolvedValue(makeSummary());
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('http://secret-host failed'));

    await expect(
      processor.process(makeJob({ attemptsMade: 2 })),
    ).rejects.toThrow();
    expect(summariesRepository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: LessonSummaryStatus.FAILED,
        error: '[redacted-url] failed',
      }),
    );
  });

  it('retains the transcript when Gemini summarization fails', async () => {
    const lesson = makeLesson();
    const summary = makeSummary();
    lessonsRepository.findOne.mockResolvedValue(lesson);
    summariesRepository.findOne.mockResolvedValue(summary);
    global.fetch = jest.fn().mockImplementation((input: string | URL) => {
      if (input.toString().endsWith('/transcribe')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            transcript: 'Noi dung day du cua bai giang.',
            language: 'vi',
            durationSeconds: 42,
          }),
        });
      }
      return Promise.reject(new Error('Gemini quota exhausted'));
    });

    await expect(
      processor.process(makeJob({ attemptsMade: 2 })),
    ).rejects.toThrow('AI summary service is unavailable');

    expect(summary).toEqual(
      expect.objectContaining({
        transcriptText: 'Noi dung day du cua bai giang.',
        transcriptLanguage: 'vi',
        transcriptDurationSeconds: 42,
        transcribedAt: expect.any(Date),
        status: LessonSummaryStatus.FAILED,
        error: 'Gemini quota exhausted',
      }),
    );
    expect(aiKnowledgeService.enqueueTranscript).toHaveBeenCalledWith(
      lesson.id,
      true,
    );
  });

  it('rejects malformed summary responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ summary: '' }),
    });
    const internals = processor as unknown as {
      summarize(request: {
        lessonId: string;
        title: string;
        transcript: string;
      }): Promise<unknown>;
    };

    await expect(
      internals.summarize({
        lessonId: 'lesson-1',
        title: 'Lesson',
        transcript: 'Transcript',
      }),
    ).rejects.toThrow('AI summary service is unavailable');
  });

  it('aborts a transcription request after its configured timeout', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'AI_URL') return 'http://ai:8000';
      if (key === 'AI_TRANSCRIBE_TIMEOUT_MS') return 1;
      return undefined;
    });
    global.fetch = jest.fn().mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const internals = processor as unknown as {
      transcribe(request: {
        lessonId: string;
        audioUrl: string;
      }): Promise<unknown>;
    };

    await expect(
      internals.transcribe({ lessonId: 'lesson-1', audioUrl: 'audio.ogg' }),
    ).rejects.toThrow('AI summary service is unavailable');
  });

  it('fails gracefully when AI_URL is absent', async () => {
    configService.get.mockReturnValue(undefined);
    const internals = processor as unknown as {
      transcribe(request: {
        lessonId: string;
        audioUrl: string;
      }): Promise<unknown>;
    };

    await expect(
      internals.transcribe({ lessonId: 'lesson-1', audioUrl: 'audio.ogg' }),
    ).rejects.toThrow('AI service is not configured');
  });
});
