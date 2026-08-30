import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum LessonWatchEventType {
  OPENED = 'opened',
  HEARTBEAT = 'heartbeat',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

@Entity('lesson_watch_events')
@Unique('UQ_lesson_watch_events_idempotency_key', ['idempotencyKey'])
@Index('IDX_lesson_watch_events_learner_lesson', ['learnerId', 'lessonId'])
export class LessonWatchEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160 })
  idempotencyKey!: string;

  @Column({ name: 'learner_id', type: 'uuid' })
  learnerId!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId!: string;

  @Column({ name: 'event_type', type: 'enum', enum: LessonWatchEventType })
  eventType!: LessonWatchEventType;

  @Column({ name: 'position_seconds', type: 'int', default: 0 })
  positionSeconds!: number;

  @Column({ name: 'watched_seconds', type: 'int', default: 0 })
  watchedSeconds!: number;

  @Column({ name: 'duration_seconds', type: 'int', default: 0 })
  durationSeconds!: number;

  @Column({ name: 'client_created_at', type: 'timestamp', nullable: true })
  clientCreatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
