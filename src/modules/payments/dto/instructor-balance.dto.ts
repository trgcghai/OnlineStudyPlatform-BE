import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { InstructorBalanceLedgerType } from '../entities/instructor-balance-ledger.entity';

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
