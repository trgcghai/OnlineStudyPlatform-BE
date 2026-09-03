import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Lesson } from '../../lessons/entities/lesson.entity';
import { Question } from './question.entity';

@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_quizzes_lesson_id_unique', { unique: true })
  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId!: string;

  @ManyToOne(() => Lesson, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson!: Lesson;

  @Column({ length: 200 })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'time_limit_minutes', type: 'int', nullable: true })
  timeLimitMinutes!: number | null;

  @Column({ name: 'pass_score', type: 'int', default: 70 })
  passScore!: number;

  @OneToMany(() => Question, (question) => question.quiz)
  questions!: Question[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
