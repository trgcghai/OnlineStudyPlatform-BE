import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  PaymentStatus,
  PaymentTransaction,
} from './payment-transaction.entity';

export const PaymentAuditActorType = {
  LEARNER: 'learner',
  SYSTEM: 'system',
  SEPAY: 'sepay',
} as const;

export type PaymentAuditActorTypeValue =
  (typeof PaymentAuditActorType)[keyof typeof PaymentAuditActorType];

@Entity('payment_audit_logs')
export class PaymentAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @ManyToOne(() => PaymentTransaction, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: PaymentTransaction;

  @Column({
    name: 'actor_type',
    type: 'varchar',
    length: 20,
  })
  actorType!: PaymentAuditActorTypeValue;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({
    name: 'from_status',
    type: 'enum',
    enum: PaymentStatus,
    nullable: true,
  })
  fromStatus!: PaymentStatus | null;

  @Column({ name: 'to_status', type: 'enum', enum: PaymentStatus })
  toStatus!: PaymentStatus;

  @Column({ type: 'int' })
  amount!: number;

  @Column({ name: 'payment_code', type: 'varchar', length: 40 })
  paymentCode!: string;

  @Column({
    name: 'provider_transaction_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  providerTransactionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
