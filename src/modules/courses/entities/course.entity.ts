import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum CourseStatus {
  DRAFT = 'Draft',
  PENDING = 'Pending',
  PUBLISHED = 'Published',
}

@Entity('courses')
export class Course {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 150 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ length: 80 })
  category!: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail!: string | null;

  @Column({ type: 'enum', enum: CourseStatus, default: CourseStatus.DRAFT })
  status!: CourseStatus;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instructor_id' })
  instructor!: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
