import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { InstructorBalanceLedgerType } from '../entities/instructor-balance-ledger.entity';
import { PaymentStatus } from '../entities/payment-transaction.entity';

export class ListInstructorRevenueReportQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ListInstructorBalanceHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export interface InstructorBalanceSummaryResponse {
  totalBalance: number;
  currentBalance: number;
  withdrawableBalance: number;
  nonWithdrawableBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
  currency: string;
}

export interface InstructorBalanceHistoryItem {
  id: string;
  type: InstructorBalanceLedgerType;
  amountDelta: number;
  currency: string;
  grossAmount: number | null;
  platformFeeAmount: number | null;
  netAmount: number | null;
  description: string;
  availableAt: Date | null;
  createdAt: Date;
  course: { id: string; title: string } | null;
  paymentTransactionId: string | null;
  withdrawRequestId: string | null;
}

export interface InstructorBalanceHistoryResponse {
  items: InstructorBalanceHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface InstructorRevenueCourseReport {
  courseId: string;
  courseTitle: string;
  purchaseCount: number;
  grossRevenue: number;
  platformFee: number;
  netRevenue: number;
  currency: string;
}

export interface InstructorRevenuePaymentStat {
  status: PaymentStatus;
  transactionCount: number;
  amount: number;
  currency: string;
}

export interface InstructorRevenueReportResponse {
  dateFrom: string | null;
  dateTo: string | null;
  summary: {
    purchaseCount: number;
    grossRevenue: number;
    platformFee: number;
    netRevenue: number;
    currency: string;
  };
  courses: InstructorRevenueCourseReport[];
  paymentStats: InstructorRevenuePaymentStat[];
}
