import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Lesson } from '../../lessons/entities/lesson.entity';

export enum LessonSummaryStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('lesson_summaries')
export class LessonSummary {
  @PrimaryColumn({ name: 'lesson_id', type: 'uuid' })
  lessonId!: string;

  @OneToOne(() => Lesson, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson!: Lesson;

  @Column({ name: 'summary_text', type: 'text', nullable: true })
  summaryText!: string | null;

  @Column({
    type: 'enum',
    enum: LessonSummaryStatus,
    default: LessonSummaryStatus.PENDING,
  })
  status!: LessonSummaryStatus;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'source_video_url', type: 'varchar', nullable: true })
  sourceVideoUrl!: string | null;

  @Column({ name: 'audio_url', type: 'varchar', nullable: true })
  audioUrl!: string | null;

  @Column({ name: 'transcript_text', type: 'text', nullable: true })
  transcriptText!: string | null;

  @Column({
    name: 'transcript_language',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  transcriptLanguage!: string | null;

  @Column({
    name: 'transcript_duration_seconds',
    type: 'double precision',
    nullable: true,
  })
  transcriptDurationSeconds!: number | null;

  @Column({ name: 'transcribed_at', type: 'timestamptz', nullable: true })
  transcribedAt!: Date | null;

  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}
