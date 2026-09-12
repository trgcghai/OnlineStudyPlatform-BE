import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentTransaction } from './payment-transaction.entity';

export const PaymentProviderEventResult = {
  PROCESSED_PAID: 'processed_paid',
  DUPLICATE_PROVIDER_EVENT: 'duplicate_provider_event',
  DUPLICATE_PAYMENT: 'duplicate_payment',
  AMOUNT_MISMATCH: 'amount_mismatch',
  EXPIRED: 'expired',
  UNKNOWN_PAYMENT_CODE: 'unknown_payment_code',
  IGNORED_TRANSFER_TYPE: 'ignored_transfer_type',
} as const;

export type PaymentProviderEventResultValue =
  (typeof PaymentProviderEventResult)[keyof typeof PaymentProviderEventResult];

@Entity('payment_provider_events')
export class PaymentProviderEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20, default: 'sepay' })
  provider!: string;

  @Column({ name: 'provider_transaction_id', type: 'varchar', length: 64 })
  @Index('UQ_payment_provider_events_provider_tx', { unique: true })
  providerTransactionId!: string;

  @Column({ name: 'payment_transaction_id', type: 'uuid', nullable: true })
  paymentTransactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_transaction_id' })
  paymentTransaction!: PaymentTransaction | null;

  @Column({
    name: 'reported_payment_code',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  reportedPaymentCode!: string | null;

  @Column({ name: 'transfer_amount', type: 'int' })
  transferAmount!: number;

  @Column({ name: 'transfer_type', type: 'varchar', length: 20 })
  transferType!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  gateway!: string | null;

  @Column({
    name: 'provider_reference_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  providerReferenceCode!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  result!: PaymentProviderEventResultValue | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'received_at', type: 'timestamp' })
  receivedAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
