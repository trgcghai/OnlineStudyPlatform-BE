import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  AI_SUMMARY_CONCURRENCY,
  AI_SUMMARY_QUEUE,
  DEFAULT_AI_SUMMARIZE_TIMEOUT_MS,
  DEFAULT_AI_TRANSCRIBE_TIMEOUT_MS,
} from './ai-summary.constants';
import {
  AiSummarizeRequest,
  AiSummarizeResponse,
  AiSummaryJobData,
  AiTranscribeRequest,
  AiTranscribeResponse,
} from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';
import { LessonAudioService } from './lesson-audio.service';

@Processor(AI_SUMMARY_QUEUE, {
  concurrency: AI_SUMMARY_CONCURRENCY,
})
export class AiSummaryProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSummaryProcessor.name);

  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    private readonly configService: ConfigService,
    private readonly lessonAudioService: LessonAudioService,
  ) {
    super();
  }

  async process(job: Job<AiSummaryJobData>): Promise<void> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: job.data.lessonId },
    });
    if (!lesson || lesson.videoUrl !== job.data.videoUrl) return;

    const summary =
      (await this.summariesRepository.findOne({
        where: { lessonId: lesson.id },
      })) ??
      this.summariesRepository.create({
        lessonId: lesson.id,
        audioUrl: null,
      });
    summary.status = LessonSummaryStatus.PROCESSING;
    summary.error = null;
    summary.sourceVideoUrl = job.data.videoUrl;
    summary.updatedAt = new Date();
    await this.summariesRepository.save(summary);

    try {
      const audioUrl = await this.resolveAudioUrl(
        lesson,
        summary,
        job.data.videoUrl,
      );
      if (!audioUrl) return;
      const transcription = await this.transcribe({
        lessonId: lesson.id,
        audioUrl,
      });
      const generatedSummary = await this.summarize({
        lessonId: lesson.id,
        title: lesson.title,
        transcript: transcription.transcript,
      });
      const current = await this.lessonsRepository.findOne({
        where: { id: lesson.id },
      });
      if (!current || current.videoUrl !== job.data.videoUrl) return;

      const currentSummary = await this.summariesRepository.findOne({
        where: { lessonId: lesson.id },
      });
      if (!currentSummary) return;
      currentSummary.summaryText = generatedSummary.summary.trim();
      currentSummary.status = LessonSummaryStatus.READY;
      currentSummary.error = null;
      currentSummary.sourceVideoUrl = job.data.videoUrl;
      currentSummary.updatedAt = new Date();
      await this.summariesRepository.save(currentSummary);
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.markFailed(job.data, error);
      }
      throw error;
    }
  }

  private async resolveAudioUrl(
    lesson: Lesson,
    summary: LessonSummary,
    expectedVideoUrl: string,
  ): Promise<string | null> {
    if (summary.audioUrl) return summary.audioUrl;

    const derived = await this.lessonAudioService.extractStoredVideo(
      expectedVideoUrl,
      lesson.courseId,
      lesson.id,
    );
    const current = await this.lessonsRepository.findOne({
      where: { id: lesson.id },
    });
    if (!current || current.videoUrl !== expectedVideoUrl) {
      await this.lessonAudioService.removeAudioQuietly(derived.url);
      return null;
    }

    summary.audioUrl = derived.url;
    summary.updatedAt = new Date();
    await this.summariesRepository.save(summary);
    return derived.url;
  }

  private isFinalAttempt(job: Job<AiSummaryJobData>): boolean {
    const attempts = Number(job.opts.attempts ?? 1);
    return job.attemptsMade + 1 >= attempts;
  }

  private async markFailed(
    data: AiSummaryJobData,
    error: unknown,
  ): Promise<void> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: data.lessonId },
    });
    if (!lesson || lesson.videoUrl !== data.videoUrl) return;

    const summary = await this.summariesRepository.findOne({
      where: { lessonId: data.lessonId },
    });
    if (!summary) return;
    summary.status = LessonSummaryStatus.FAILED;
    summary.error = this.sanitizeError(error);
    summary.updatedAt = new Date();
    await this.summariesRepository.save(summary);
  }

  private sanitizeError(error: unknown): string {
    const message = this.toSafeErrorMessage(error);
    this.logger.warn(message);
    return message;
  }

  private toSafeErrorMessage(error: unknown): string {
    let source = error;
    while (source instanceof Error && source.cause instanceof Error) {
      source = source.cause;
    }
    const message =
      source instanceof Error ? source.message : 'Unknown AI summary error';
    return message.replace(/https?:\/\/\S+/gi, '[redacted-url]').slice(0, 500);
  }

  private transcribe(
    request: AiTranscribeRequest,
  ): Promise<AiTranscribeResponse> {
    return this.post<AiTranscribeResponse>(
      '/transcribe',
      request,
      this.getTimeout(
        'AI_TRANSCRIBE_TIMEOUT_MS',
        DEFAULT_AI_TRANSCRIBE_TIMEOUT_MS,
      ),
      this.isTranscribeResponse,
    );
  }

  private summarize(request: AiSummarizeRequest): Promise<AiSummarizeResponse> {
    return this.post<AiSummarizeResponse>(
      '/summarize',
      request,
      this.getTimeout(
        'AI_SUMMARIZE_TIMEOUT_MS',
        DEFAULT_AI_SUMMARIZE_TIMEOUT_MS,
      ),
      this.isSummarizeResponse,
    );
  }

  private async post<T>(
    path: string,
    body: object,
    timeoutMs: number,
    isValid: (value: unknown) => value is T,
  ): Promise<T> {
    const aiUrl = this.configService.get<string>('AI_URL')?.replace(/\/$/, '');
    if (!aiUrl) {
      throw new Error('AI service is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const token = this.configService.get<string>('AI_TOKEN');
      const response = await fetch(`${aiUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `AI summary endpoint ${path} returned ${response.status}`,
        );
        throw new Error('AI service rejected the summary request');
      }

      const payload: unknown = await response.json();
      if (!isValid(payload)) {
        throw new Error('AI service returned an invalid summary response');
      }
      return payload;
    } catch (error) {
      const message = this.toSafeErrorMessage(error);
      this.logger.warn(`AI summary endpoint ${path} unavailable: ${message}`);
      throw new Error('AI summary service is unavailable', { cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  private getTimeout(key: string, fallback: number): number {
    const parsed = Number(this.configService.get<string | number>(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private isTranscribeResponse(
    this: void,
    value: unknown,
  ): value is AiTranscribeResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiTranscribeResponse>;
    return (
      typeof response.transcript === 'string' &&
      response.transcript.trim().length > 0 &&
      typeof response.language === 'string' &&
      typeof response.durationSeconds === 'number'
    );
  }

  private isSummarizeResponse(
    this: void,
    value: unknown,
  ): value is AiSummarizeResponse {
    if (!value || typeof value !== 'object') return false;
    const response = value as Partial<AiSummarizeResponse>;
    return (
      typeof response.summary === 'string' &&
      response.summary.trim().length > 0 &&
      response.provider === 'gemini'
    );
  }
}
