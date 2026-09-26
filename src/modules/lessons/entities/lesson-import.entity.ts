import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Course } from '../../courses/entities/course.entity';
import { User } from '../../users/entities/user.entity';

export enum LessonImportStatus {
  UPLOADING = 'uploading',
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ABORTED = 'aborted',
}

const numberTransformer = {
  to: (value: number) => value,
  from: (value: string | number) => Number(value),
};

@Entity('lesson_imports')
@Index('IDX_lesson_imports_course_status', ['courseId', 'status'])
@Index('IDX_lesson_imports_created_at', ['createdAt'])
export class LessonImport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'course_id', type: 'uuid' })
  courseId!: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course!: Course;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instructor_id' })
  instructor!: User;

  @Column({ name: 'source_filename', length: 255 })
  sourceFilename!: string;

  @Column({ name: 'source_object_key', length: 500 })
  sourceObjectKey!: string;

  @Column({
    name: 'declared_size',
    type: 'bigint',
    transformer: numberTransformer,
  })
  declaredSize!: number;

  @Column({ name: 'multipart_upload_id', length: 500 })
  multipartUploadId!: string;

  @Column({ name: 'expected_part_count', type: 'int' })
  expectedPartCount!: number;

  @Column({ type: 'enum', enum: LessonImportStatus })
  status!: LessonImportStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ name: 'error_details', type: 'jsonb', default: () => "'[]'" })
  errorDetails!: string[];

  @Column({ name: 'created_lesson_count', type: 'int', default: 0 })
  createdLessonCount!: number;

  @Column({ name: 'first_position', type: 'int', nullable: true })
  firstPosition!: number | null;

  @Column({ name: 'last_position', type: 'int', nullable: true })
  lastPosition!: number | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
