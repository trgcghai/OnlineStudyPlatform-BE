import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { LessonSummary } from '../ai-summary/entities/lesson-summary.entity';
import { CourseStatus } from '../courses/entities/course.entity';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  AI_KNOWLEDGE_DELETE_COURSE_JOB,
  AI_KNOWLEDGE_DELETE_SOURCE_JOB,
  AI_KNOWLEDGE_INDEX_JOB,
  AI_KNOWLEDGE_QUEUE,
  DEFAULT_AI_KNOWLEDGE_ATTEMPTS,
  DEFAULT_AI_KNOWLEDGE_BACKOFF_MS,
} from './ai-knowledge.constants';
import { AiKnowledgeJobData } from './dto/ai-knowledge.dto';
import {
  KnowledgeSourceStatus,
  KnowledgeSourceType,
  LessonKnowledgeSource,
} from './entities/lesson-knowledge-source.entity';

@Injectable()
export class AiKnowledgeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiKnowledgeService.name);

  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    @InjectRepository(LessonKnowledgeSource)
    private readonly sourcesRepository: Repository<LessonKnowledgeSource>,
    @InjectQueue(AI_KNOWLEDGE_QUEUE)
    private readonly queue: Queue<AiKnowledgeJobData>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.getBoolean('AI_KNOWLEDGE_BACKFILL_ON_START', false)) return;
    try {
      const lessons = await this.lessonsRepository.find({
        select: { id: true },
        where: { course: { status: CourseStatus.PUBLISHED } },
      });
      for (const lesson of lessons) {
        await this.enqueueLesson(lesson.id, false);
      }
      this.logger.log(`Knowledge backfill inspected ${lessons.length} lessons`);
    } catch (error) {
      this.logger.error(
        'Knowledge backfill failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async enqueueCourse(courseId: string, force = false): Promise<number> {
    const lessons = await this.lessonsRepository.find({ where: { courseId } });
    const results = await Promise.allSettled(
      lessons.map((lesson) => this.enqueueLesson(lesson.id, force)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Could not enqueue knowledge for lesson ${lessons[index].id}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    });
    return results
      .filter(
        (result): result is PromiseFulfilledResult<number> =>
          result.status === 'fulfilled',
      )
      .reduce((total, result) => total + result.value, 0);
  }

  async enqueueLesson(lessonId: string, force = false): Promise<number> {
    const [material, transcript] = await Promise.all([
      this.enqueueMaterial(lessonId, force),
      this.enqueueTranscript(lessonId, force),
    ]);
    return Number(material) + Number(transcript);
  }

  async enqueueMaterial(lessonId: string, force = false): Promise<boolean> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId },
    });
    if (!lesson?.materialUrl) return false;
    return this.upsertAndEnqueue(
      lesson,
      KnowledgeSourceType.MATERIAL,
      lesson.materialUrl,
      this.hash(lesson.materialUrl),
      force,
    );
  }

  async enqueueTranscript(lessonId: string, force = false): Promise<boolean> {
    const [lesson, summary] = await Promise.all([
      this.lessonsRepository.findOne({ where: { id: lessonId } }),
      this.summariesRepository.findOne({ where: { lessonId } }),
    ]);
    if (!lesson || !summary?.transcriptText?.trim()) return false;
    return this.upsertAndEnqueue(
      lesson,
      KnowledgeSourceType.TRANSCRIPT,
      null,
      this.hash(summary.transcriptText),
      force,
    );
  }

  async deleteLessonSources(lessonId: string): Promise<void> {
    const sources = await this.sourcesRepository.find({ where: { lessonId } });
    await Promise.all(
      sources.map((source) => this.enqueueDeleteSource(source.id)),
    );
  }

  async invalidateTranscript(lessonId: string): Promise<void> {
    const source = await this.sourcesRepository.findOne({
      where: { lessonId, sourceType: KnowledgeSourceType.TRANSCRIPT },
    });
    if (!source) return;
    source.status = KnowledgeSourceStatus.PENDING;
    source.chunkCount = 0;
    source.error = null;
    source.indexedAt = null;
    await this.sourcesRepository.save(source);
    await this.enqueueDeleteSource(source.id);
  }

  async deleteCourseSources(courseId: string): Promise<void> {
    await this.queue.add(
      AI_KNOWLEDGE_DELETE_COURSE_JOB,
      { action: 'delete-course', courseId },
      this.jobOptions(`knowledge-delete-course-${courseId}`),
    );
  }

  private async upsertAndEnqueue(
    lesson: Lesson,
    sourceType: KnowledgeSourceType,
    sourceUrl: string | null,
    contentHash: string,
    force: boolean,
  ): Promise<boolean> {
    let source = await this.sourcesRepository.findOne({
      where: { lessonId: lesson.id, sourceType },
    });
    if (
      !force &&
      source?.status === KnowledgeSourceStatus.READY &&
      source.contentHash === contentHash
    ) {
      return false;
    }

    source ??= this.sourcesRepository.create({
      courseId: lesson.courseId,
      lessonId: lesson.id,
      sourceType,
    });
    source.courseId = lesson.courseId;
    source.sourceUrl = sourceUrl;
    source.contentHash = contentHash;
    source.status = KnowledgeSourceStatus.PENDING;
    source.chunkCount = 0;
    source.error = null;
    source.indexedAt = null;
    source = await this.sourcesRepository.save(source);

    try {
      await this.queue.add(
        AI_KNOWLEDGE_INDEX_JOB,
        { action: 'index', sourceId: source.id, contentHash },
        this.jobOptions(
          `knowledge-index-${source.id}-${contentHash.slice(0, 16)}`,
        ),
      );
      return true;
    } catch (error) {
      source.status = KnowledgeSourceStatus.FAILED;
      source.error = 'Could not enqueue knowledge indexing';
      await this.sourcesRepository.save(source);
      throw error;
    }
  }

  private enqueueDeleteSource(sourceId: string): Promise<unknown> {
    return this.queue.add(
      AI_KNOWLEDGE_DELETE_SOURCE_JOB,
      { action: 'delete-source', sourceId },
      this.jobOptions(`knowledge-delete-source-${sourceId}`),
    );
  }

  private jobOptions(jobId: string) {
    return {
      jobId,
      attempts: this.getPositiveInteger(
        'AI_KNOWLEDGE_ATTEMPTS',
        DEFAULT_AI_KNOWLEDGE_ATTEMPTS,
      ),
      backoff: {
        type: 'exponential' as const,
        delay: this.getPositiveInteger(
          'AI_KNOWLEDGE_BACKOFF_MS',
          DEFAULT_AI_KNOWLEDGE_BACKOFF_MS,
        ),
      },
      removeOnComplete: true,
      removeOnFail: true,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private getPositiveInteger(key: string, fallback: number): number {
    const value = Number(this.configService.get<string | number>(key));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private getBoolean(key: string, fallback: boolean): boolean {
    const value = this.configService.get<string | boolean>(key);
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    return value.trim().toLowerCase() === 'true';
  }
}
