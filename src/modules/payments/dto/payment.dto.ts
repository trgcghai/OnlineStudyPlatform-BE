import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaymentStatus } from '../entities/payment-transaction.entity';

export class CheckoutCourseDto {
  @IsUUID()
  courseId!: string;
}

export class PaymentTransactionResponse {
  id!: string;
  learnerId!: string;
  courseId!: string;
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
}

export class CheckoutResponse extends PaymentTransactionResponse {
  bankAccount!: string;
  bankHolder!: string;
  bankCode!: string;
  qrImageUrl!: string;
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
