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
  PROCESSED = 'processed',
  CANCELLED = 'cancelled',
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
