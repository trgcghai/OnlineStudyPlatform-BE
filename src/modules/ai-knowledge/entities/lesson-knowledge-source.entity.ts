import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Course } from '../../courses/entities/course.entity';
import { Lesson } from '../../lessons/entities/lesson.entity';

export enum KnowledgeSourceType {
  TRANSCRIPT = 'transcript',
  MATERIAL = 'material',
}

export enum KnowledgeSourceStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('lesson_knowledge_sources')
@Unique('UQ_lesson_knowledge_source_lesson_type', ['lessonId', 'sourceType'])
@Index('IDX_lesson_knowledge_source_course_status', ['courseId', 'status'])
export class LessonKnowledgeSource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course!: Course;

  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId!: string;

  @ManyToOne(() => Lesson, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson!: Lesson;

  @Column({ name: 'source_type', type: 'enum', enum: KnowledgeSourceType })
  sourceType!: KnowledgeSourceType;

  @Column({ name: 'source_url', type: 'varchar', nullable: true })
  sourceUrl!: string | null;

  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash!: string;

  @Column({
    type: 'enum',
    enum: KnowledgeSourceStatus,
    default: KnowledgeSourceStatus.PENDING,
  })
  status!: KnowledgeSourceStatus;

  @Column({ name: 'chunk_count', type: 'integer', default: 0 })
  chunkCount!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'indexed_at', type: 'timestamptz', nullable: true })
  indexedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
