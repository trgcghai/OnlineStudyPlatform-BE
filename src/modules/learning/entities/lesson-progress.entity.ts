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
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { Lesson } from '../../lessons/entities/lesson.entity';
import { User } from '../../users/entities/user.entity';

@Entity('lesson_progress')
@Unique('UQ_lesson_progress_learner_lesson', ['learnerId', 'lessonId'])
@Index('IDX_lesson_progress_learner_course', ['learnerId', 'courseId'])
export class LessonProgress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'learner_id', type: 'uuid' })
  learnerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'learner_id' })
  learner!: User;

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

  @Column({ name: 'enrollment_id', type: 'uuid' })
  enrollmentId!: string;

  @ManyToOne(() => Enrollment, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'enrollment_id' })
  enrollment!: Enrollment;

  @Column({ name: 'watched_seconds', type: 'int', default: 0 })
  watchedSeconds!: number;

  @Column({ name: 'last_position_seconds', type: 'int', default: 0 })
  lastPositionSeconds!: number;

  @Column({
    name: 'watch_ratio',
    type: 'decimal',
    precision: 6,
    scale: 4,
    default: 0,
  })
  watchRatio!: string;

  @Column({ name: 'watch_completed_at', type: 'timestamp', nullable: true })
  watchCompletedAt!: Date | null;

  @Column({ name: 'lesson_completed_at', type: 'timestamp', nullable: true })
  lessonCompletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
