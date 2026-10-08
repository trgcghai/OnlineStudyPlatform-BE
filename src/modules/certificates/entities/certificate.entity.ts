import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Course } from '../../courses/entities/course.entity';
import { User } from '../../users/entities/user.entity';

@Entity('certificates')
@Unique('UQ_certificates_learner_course', ['learnerId', 'courseId'])
@Unique('UQ_certificates_object_key', ['objectKey'])
export class Certificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'learner_id', type: 'uuid', update: false })
  learnerId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'learner_id' })
  learner!: User;

  @Column({ name: 'course_id', type: 'uuid', update: false })
  courseId!: string;

  @ManyToOne(() => Course, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'course_id' })
  course!: Course;

  @Column({ name: 'issued_at', type: 'timestamptz', update: false })
  issuedAt!: Date;

  @Column({ name: 'certificate_url', type: 'varchar', update: false })
  certificateUrl!: string;

  @Column({ name: 'object_key', type: 'varchar', update: false })
  objectKey!: string;

  @Column({ name: 'learner_name', type: 'varchar', update: false })
  learnerName!: string;

  @Column({ name: 'course_title', type: 'varchar', update: false })
  courseTitle!: string;
}
