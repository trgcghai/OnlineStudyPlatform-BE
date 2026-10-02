import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import { AiKnowledgeService } from '../ai-knowledge/ai-knowledge.service';
import {
  AI_SUMMARY_CONCURRENCY,
  AI_SUMMARY_QUEUE,
} from './ai-summary.constants';
import {
  AiSummaryJobData,
  AiTranscribeResponse,
} from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';
import { LessonAudioService } from './lesson-audio.service';
import { AiSummaryClient } from './ai-summary.client';

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
    private readonly lessonAudioService: LessonAudioService,
    private readonly aiKnowledgeService: AiKnowledgeService,
    private readonly aiSummaryClient: AiSummaryClient,
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
      const transcription = await this.aiSummaryClient.transcribe({
        lessonId: lesson.id,
        audioUrl,
      });
      const transcriptWasSaved = await this.persistTranscript(
        lesson.id,
        job.data.videoUrl,
        transcription,
      );
      if (!transcriptWasSaved) return;
      await this.enqueueTranscriptQuietly(lesson.id);
      const generatedSummary = await this.aiSummaryClient.summarize({
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

  private async persistTranscript(
    lessonId: string,
    expectedVideoUrl: string,
    transcription: AiTranscribeResponse,
  ): Promise<boolean> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId },
    });
    if (!lesson || lesson.videoUrl !== expectedVideoUrl) return false;

    const summary = await this.summariesRepository.findOne({
      where: { lessonId },
    });
    if (!summary || summary.sourceVideoUrl !== expectedVideoUrl) return false;
    summary.transcriptText = transcription.transcript.trim();
    summary.transcriptLanguage = transcription.language;
    summary.transcriptDurationSeconds = transcription.durationSeconds;
    summary.transcribedAt = new Date();
    summary.updatedAt = new Date();
    await this.summariesRepository.save(summary);
    return true;
  }

  private async enqueueTranscriptQuietly(lessonId: string): Promise<void> {
    try {
      await this.aiKnowledgeService.enqueueTranscript(lessonId, true);
    } catch (error) {
      this.logger.error(
        `Could not enqueue transcript knowledge for lesson ${lessonId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
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

}
