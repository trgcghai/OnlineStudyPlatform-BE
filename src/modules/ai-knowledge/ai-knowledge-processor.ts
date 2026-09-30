import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  AI_KNOWLEDGE_CONCURRENCY,
  AI_KNOWLEDGE_QUEUE,
} from './ai-knowledge.constants';
import { AiKnowledgeGatewayService } from './ai-knowledge-gateway.service';
import { AiKnowledgeJobData } from './dto/ai-knowledge.dto';
import {
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  LessonKnowledgeSource,
} from './entities/lesson-knowledge-source.entity';

@Processor(AI_KNOWLEDGE_QUEUE, { concurrency: AI_KNOWLEDGE_CONCURRENCY })
export class AiKnowledgeProcessor extends WorkerHost {
  private readonly logger = new Logger(AiKnowledgeProcessor.name);

  constructor(
    @InjectRepository(LessonKnowledgeSource)
    private readonly sourcesRepository: Repository<LessonKnowledgeSource>,
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    private readonly gateway: AiKnowledgeGatewayService,
  ) {
    super();
  }

  async process(job: Job<AiKnowledgeJobData>): Promise<void> {
    if (job.data.action === 'delete-source') {
      await this.gateway.deleteSource(job.data.sourceId);
      return;
    }
    if (job.data.action === 'delete-course') {
      await this.gateway.deleteCourse(job.data.courseId);
      return;
    }

    const source = await this.sourcesRepository.findOne({
      where: { id: job.data.sourceId },
    });
    if (!source || source.contentHash !== job.data.contentHash) return;

    const lesson = await this.lessonsRepository.findOne({
      where: { id: source.lessonId },
    });
    if (!lesson) return;

    source.status = KnowledgeSourceStatus.PROCESSING;
    source.error = null;
    await this.sourcesRepository.save(source);

    try {
      const transcript =
        source.sourceType === KnowledgeSourceType.TRANSCRIPT
          ? await this.loadTranscript(source.lessonId)
          : undefined;
      const response = await this.gateway.index({
        sourceId: source.id,
        courseId: source.courseId,
        lessonId: source.lessonId,
        lessonTitle: lesson.title,
        sourceType: source.sourceType,
        contentHash: source.contentHash,
        ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
        ...(transcript ? { transcript } : {}),
      });

      const current = await this.sourcesRepository.findOne({
        where: { id: source.id },
      });
      if (
        !current ||
        current.contentHash !== job.data.contentHash ||
        response.contentHash !== job.data.contentHash
      ) {
        return;
      }
      current.status = KnowledgeSourceStatus.READY;
      current.chunkCount = response.chunkCount;
      current.error = null;
      current.indexedAt = new Date();
      await this.sourcesRepository.save(current);
    } catch (error) {
      if (this.isFinalAttempt(job)) {
        await this.markFailed(job.data.sourceId, job.data.contentHash, error);
      }
      throw error;
    }
  }

  private async loadTranscript(lessonId: string): Promise<string> {
    const summary = await this.summariesRepository.findOne({
      where: { lessonId },
    });
    const transcript = summary?.transcriptText?.trim();
    if (!transcript) throw new Error('Lesson transcript is not available');
    return transcript;
  }

  private isFinalAttempt(job: Job<AiKnowledgeJobData>): boolean {
    const attempts = Number(job.opts.attempts ?? 1);
    return job.attemptsMade + 1 >= attempts;
  }

  private async markFailed(
    sourceId: string,
    expectedHash: string,
    error: unknown,
  ): Promise<void> {
    const current = await this.sourcesRepository.findOne({
      where: { id: sourceId },
    });
    if (!current || current.contentHash !== expectedHash) return;
    current.status = KnowledgeSourceStatus.FAILED;
    current.error = this.sanitizeError(error);
    current.indexedAt = null;
    await this.sourcesRepository.save(current);
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const safe = message
      .replace(/https?:\/\/\S+/gi, '[redacted-url]')
      .slice(0, 500);
    this.logger.warn(safe);
    return safe;
  }
}
