import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Course } from '../../courses/entities/course.entity';
import { User } from '../../users/entities/user.entity';
import { PaymentTransaction } from './payment-transaction.entity';
import { WithdrawRequest } from './withdraw-request.entity';

export enum InstructorBalanceLedgerType {
  EARNING_CREDIT = 'earning_credit',
  WITHDRAW_DEBIT = 'withdraw_debit',
}

@Entity('instructor_balance_ledger')
@Index('IDX_instructor_balance_ledger_instructor_created', [
  'instructorId',
  'createdAt',
])
@Index('UQ_instructor_balance_ledger_payment', ['paymentTransactionId'], {
  unique: true,
  where: 'payment_transaction_id IS NOT NULL',
})
@Index('UQ_instructor_balance_ledger_withdraw', ['withdrawRequestId'], {
  unique: true,
  where: 'withdraw_request_id IS NOT NULL',
})
export class InstructorBalanceLedger {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instructor_id', type: 'uuid' })
  instructorId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'instructor_id' })
  instructor!: User;

  @Column({ type: 'enum', enum: InstructorBalanceLedgerType })
  type!: InstructorBalanceLedgerType;

  @Column({ name: 'amount_delta', type: 'int' })
  amountDelta!: number;

  @Column({ type: 'varchar', length: 3, default: 'VND' })
  currency!: string;

  @Column({ name: 'gross_amount', type: 'int', nullable: true })
  grossAmount!: number | null;

  @Column({ name: 'platform_fee_amount', type: 'int', nullable: true })
  platformFeeAmount!: number | null;

  @Column({ name: 'net_amount', type: 'int', nullable: true })
  netAmount!: number | null;

  @Column({ name: 'course_id', type: 'uuid', nullable: true })
  courseId!: string | null;

  @ManyToOne(() => Course, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'course_id' })
  course!: Course | null;

  @Column({ name: 'payment_transaction_id', type: 'uuid', nullable: true })
  paymentTransactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_transaction_id' })
  paymentTransaction!: PaymentTransaction | null;

  @Column({ name: 'withdraw_request_id', type: 'uuid', nullable: true })
  withdrawRequestId!: string | null;

  @ManyToOne(() => WithdrawRequest, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'withdraw_request_id' })
  withdrawRequest!: WithdrawRequest | null;

  @Column({ type: 'text' })
  description!: string;

  @Column({ name: 'available_at', type: 'timestamp', nullable: true })
  availableAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
