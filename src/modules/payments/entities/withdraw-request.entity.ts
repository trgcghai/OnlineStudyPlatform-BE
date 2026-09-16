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

export enum WithdrawRequestStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

@Entity('withdraw_requests')
export class WithdrawRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instructor_id' })
  instructor!: User;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: WithdrawRequestStatus,
    default: WithdrawRequestStatus.PENDING,
  })
  status!: WithdrawRequestStatus;

  @Column({ name: 'requested_at', type: 'timestamp' })
  requestedAt!: Date;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true })
  rejectedAt!: Date | null;

  @Column({ name: 'processing_at', type: 'timestamp', nullable: true })
  processingAt!: Date | null;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt!: Date | null;

  @Column({
    name: 'payout_reference',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  payoutReference!: string | null;

  @Column({
    name: 'payout_description',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  payoutDescription!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
