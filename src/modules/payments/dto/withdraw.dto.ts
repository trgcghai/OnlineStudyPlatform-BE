import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WithdrawRequestStatus } from '../entities/withdraw-request.entity';

export type WithdrawAmountSort = 'asc' | 'desc';

export class CreateWithdrawRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListMyWithdrawRequestsQueryDto {
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

export class CancelWithdrawRequestDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectWithdrawRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class ListAdminWithdrawRequestsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  instructorEmail?: string;

  @IsOptional()
  @IsEnum(WithdrawRequestStatus)
  status?: WithdrawRequestStatus;

  @IsOptional()
  @IsDateString()
  requestedAtFrom?: string;

  @IsOptional()
  @IsDateString()
  requestedAtTo?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  amountSort: WithdrawAmountSort = 'desc';

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

export interface WithdrawRequestResponse {
  id: string;
  instructorId: string;
  amount: number;
  currency: string;
  status: WithdrawRequestStatus;
  requestedAt: Date;
  note: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  rejectReason: string | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WithdrawRequestListResponse {
  items: WithdrawRequestResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminWithdrawRequestItem {
  id: string;
  amount: number;
  currency: string;
  status: WithdrawRequestStatus;
  requestedAt: Date;
  note: string | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  rejectReason: string | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  instructor: {
    name: string;
    email: string;
  };
}

export interface AdminWithdrawRequestListResponse {
  items: AdminWithdrawRequestItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
