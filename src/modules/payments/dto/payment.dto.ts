import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentStatus } from '../entities/payment-transaction.entity';

export class CheckoutCourseDto {
  @IsUUID()
  courseId!: string;
}

export class PaymentTransactionResponse {
  id!: string;
  learnerId!: string;
  courseId!: string;
  orderId!: string | null;
  amount!: number;
  currency!: string;
  status!: PaymentStatus;
  paymentCode!: string;
  provider!: string;
  providerTransactionId!: string | null;
  providerGateway!: string | null;
  providerReferenceCode!: string | null;
  expiresAt!: Date;
  paidAt!: Date | null;
  createdAt!: Date;
  orderItems!: PaymentOrderItemResponse[];
}

export interface PaymentOrderItemResponse {
  id: string;
  courseId: string;
  courseTitle: string;
  instructorName: string | null;
  unitPrice: number;
}

export class CheckoutResponse extends PaymentTransactionResponse {
  bankAccount!: string;
  bankHolder!: string;
  bankCode!: string;
  qrImageUrl!: string;
}

export class ListLearnerPaymentTransactionsQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export interface LearnerPaymentTransactionItem {
  id: string;
  courseTitle: string;
  amount: number;
  status: PaymentStatus;
  createdAt: Date;
  paidAt: Date | null;
}

export interface LearnerPaymentTransactionListResponse {
  items: LearnerPaymentTransactionItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class SePayWebhookPayload {
  @IsNumber()
  id!: number;

  @IsString()
  gateway!: string;

  @IsString()
  transactionDate!: string;

  @IsString()
  accountNumber!: string;

  @IsOptional()
  @IsString()
  subAccount?: string;

  @IsOptional()
  @IsString()
  code!: string | null;

  @IsString()
  content!: string;

  @IsString()
  transferType!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  transferAmount!: number;

  @IsOptional()
  @IsNumber()
  accumulated?: number;

  @IsOptional()
  @IsString()
  referenceCode?: string;
}

export const SE_PAY_TRANSFER_IN = 'in';
