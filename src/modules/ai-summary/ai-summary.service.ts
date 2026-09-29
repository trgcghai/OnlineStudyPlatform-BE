import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Queue } from 'bullmq';
import { IsNull, Not, Repository } from 'typeorm';
import { Lesson } from '../lessons/entities/lesson.entity';
import {
  AI_SUMMARY_JOB,
  AI_SUMMARY_QUEUE,
  DEFAULT_AI_SUMMARY_ATTEMPTS,
  DEFAULT_AI_SUMMARY_BACKOFF_MS,
} from './ai-summary.constants';
import { AiSummaryJobData } from './dto/ai-summary.dto';
import {
  LessonSummary,
  LessonSummaryStatus,
} from './entities/lesson-summary.entity';

@Injectable()
export class AiSummaryService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepository: Repository<Lesson>,
    @InjectRepository(LessonSummary)
    private readonly summariesRepository: Repository<LessonSummary>,
    @InjectQueue(AI_SUMMARY_QUEUE)
    private readonly queue: Queue<AiSummaryJobData>,
    private readonly configService: ConfigService,
  ) {}

  async enqueueCourse(courseId: string): Promise<number> {
    const lessons = await this.lessonsRepository.find({
      where: { courseId, videoUrl: Not(IsNull()) },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const results = await Promise.allSettled(
      lessons.map((lesson) => this.enqueueLessonEntity(lesson)),
    );
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (rejection) throw rejection.reason;
    return lessons.length;
  }

  async enqueueLesson(lessonId: string): Promise<boolean> {
    const lesson = await this.lessonsRepository.findOne({
      where: { id: lessonId },
    });
    if (!lesson?.videoUrl) return false;
    await this.enqueueLessonEntity(lesson);
    return true;
  }

  private async enqueueLessonEntity(lesson: Lesson): Promise<void> {
    const videoUrl = lesson.videoUrl;
    if (!videoUrl) return;

    const summary =
      (await this.summariesRepository.findOne({
        where: { lessonId: lesson.id },
      })) ??
      this.summariesRepository.create({
        lessonId: lesson.id,
        audioUrl: null,
      });
    summary.summaryText = null;
    summary.status = LessonSummaryStatus.PENDING;
    summary.error = null;
    summary.sourceVideoUrl = videoUrl;
    summary.updatedAt = new Date();
    await this.summariesRepository.save(summary);

    try {
      await this.queue.add(
        AI_SUMMARY_JOB,
        { lessonId: lesson.id, videoUrl },
        {
          jobId: this.createJobId(lesson.id, videoUrl),
          attempts: this.getPositiveInteger(
            'AI_SUMMARY_ATTEMPTS',
            DEFAULT_AI_SUMMARY_ATTEMPTS,
          ),
          backoff: {
            type: 'exponential',
            delay: this.getPositiveInteger(
              'AI_SUMMARY_BACKOFF_MS',
              DEFAULT_AI_SUMMARY_BACKOFF_MS,
            ),
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      summary.status = LessonSummaryStatus.FAILED;
      summary.error = 'Could not enqueue AI summary processing';
      summary.updatedAt = new Date();
      await this.summariesRepository.save(summary);
      throw error;
    }
  }

  private createJobId(lessonId: string, videoUrl: string): string {
    const sourceHash = createHash('sha256')
      .update(videoUrl)
      .digest('hex')
      .slice(0, 16);
    return `lesson-summary-${lessonId}-${sourceHash}`;
  }

  private getPositiveInteger(key: string, fallback: number): number {
    const parsed = Number(this.configService.get<string | number>(key));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
