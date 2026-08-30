import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Quiz } from './quiz.entity';

export enum QuestionType {
  MCQ = 'MCQ',
  ESSAY = 'ESSAY',
}

@Entity('questions')
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'quiz_id', type: 'uuid' })
  quizId!: string;

  @ManyToOne(() => Quiz, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quiz_id' })
  quiz!: Quiz;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'type', type: 'enum', enum: QuestionType })
  type!: QuestionType;

  @Column({ type: 'jsonb' })
  options!: string[];

  @Column({ name: 'correct_answers', type: 'jsonb' })
  correctAnswers!: number[];

  @Column({ type: 'int', default: 1 })
  points!: number;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
