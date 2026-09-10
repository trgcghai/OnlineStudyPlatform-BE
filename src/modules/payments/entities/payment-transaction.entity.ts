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
import { User } from '../../users/entities/user.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

@Entity('payment_transactions')
@Unique('UQ_payment_transactions_payment_code', ['paymentCode'])
export class PaymentTransaction {
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

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency!: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @Column({ name: 'payment_code', type: 'varchar', length: 40 })
  paymentCode!: string;

  @Column({ type: 'varchar', length: 20, default: 'sepay' })
  provider!: string;

  @Column({
    name: 'provider_transaction_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  @Index('UQ_payment_transactions_provider_tx', { unique: true })
  providerTransactionId!: string | null;

  @Column({
    name: 'provider_gateway',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  providerGateway!: string | null;

  @Column({
    name: 'provider_reference_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  providerReferenceCode!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt!: Date;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
