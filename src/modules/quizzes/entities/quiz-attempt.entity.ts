import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { QuizAttemptStatus } from '../dto/quiz-attempt.dto';
import { Quiz } from './quiz.entity';

@Entity('quiz_attempts')
export class QuizAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId!: string;

  @ManyToOne(() => Quiz, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'quiz_id' })
  quiz!: Quiz;

  @Column({ name: 'learner_id', type: 'uuid' })
  learnerId!: string;

  @Column({
    type: 'enum',
    enum: QuizAttemptStatus,
    default: QuizAttemptStatus.IN_PROGRESS,
  })
  status!: QuizAttemptStatus;

  @Column({ type: 'numeric', precision: 8, scale: 2, default: 0 })
  score!: string;

  @Column({
    name: 'total_points',
    type: 'numeric',
    precision: 8,
    scale: 2,
    default: 0,
  })
  totalPoints!: string;

  @Column({ name: 'pass_score', type: 'int', default: 70 })
  passScore!: number;

  @Column({ name: 'pass_score_points', type: 'int', default: 0 })
  passScorePoints!: number;

  @Column({ type: 'boolean', default: false })
  passed!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  answers!: unknown;

  @Column({ name: 'grading_result', type: 'jsonb', nullable: true })
  gradingResult!: unknown;

  @Column({ name: 'correct_count', type: 'int', default: 0 })
  correctCount!: number;

  @Column({ name: 'wrong_count', type: 'int', default: 0 })
  wrongCount!: number;

  @Column({ name: 'pending_essay_count', type: 'int', default: 0 })
  pendingEssayCount!: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'time_limit_minutes', type: 'int', nullable: true })
  timeLimitMinutes!: number | null;

  @Column({ name: 'is_late', type: 'boolean', default: false })
  isLate!: boolean;

  @Column({ name: 'late_seconds', type: 'int', default: 0 })
  lateSeconds!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
