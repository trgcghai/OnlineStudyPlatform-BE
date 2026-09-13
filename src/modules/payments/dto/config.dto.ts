import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const PAYMENT_CONFIG_SUPPORTED_CURRENCIES = ['VND'] as const;
export type PaymentConfigCurrency =
  (typeof PAYMENT_CONFIG_SUPPORTED_CURRENCIES)[number];
export const MINIMUM_WITHDRAWAL_AMOUNT_MIN = 1000000; // 1 million VND
export const MINIMUM_WITHDRAWAL_AMOUNT_STEP = 100000; // 100k VND
export const EARNING_HOLD_DAYS_MIN = 7; // 7 days

export const DEFAULT_PAYMENT_CONFIG = {
  platformFeePercent: 20,
  currency: 'VND' as PaymentConfigCurrency,
  allowedPrices: [0, 99000, 199000, 299000, 499000, 799000, 999000],
  freeCourseLimit: 3,
  minimumWithdrawalAmount: MINIMUM_WITHDRAWAL_AMOUNT_MIN,
  earningHoldDays: EARNING_HOLD_DAYS_MIN,
  updatedById: null,
} as const;

export class UpdatePaymentConfigDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  platformFeePercent!: number;

  @IsIn(PAYMENT_CONFIG_SUPPORTED_CURRENCIES)
  currency!: PaymentConfigCurrency;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  allowedPrices!: number[];

  @ValidateIf((dto: UpdatePaymentConfigDto) => dto.freeCourseLimit !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  freeCourseLimit!: number | null;

  @IsInt()
  @Min(MINIMUM_WITHDRAWAL_AMOUNT_MIN)
  minimumWithdrawalAmount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(EARNING_HOLD_DAYS_MIN)
  earningHoldDays!: number;
}

export class ListPaymentConfigAuditsQueryDto {
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

export interface PaymentConfigResponse {
  id: string;
  platformFeePercent: number;
  currency: PaymentConfigCurrency;
  allowedPrices: number[];
  freeCourseLimit: number | null;
  minimumWithdrawalAmount: number;
  earningHoldDays: number;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentConfigSnapshot {
  platformFeePercent: number;
  currency: PaymentConfigCurrency;
  allowedPrices: number[];
  freeCourseLimit: number | null;
  minimumWithdrawalAmount: number;
  earningHoldDays: number;
  updatedById: string | null;
}

export interface PaymentConfigAuditResponse {
  id: string;
  configId: string;
  actorEmail: string;
  previousValue: PaymentConfigSnapshot;
  newValue: PaymentConfigSnapshot;
  changedFields: string[];
  createdAt: Date;
}

export interface PaymentConfigAuditListResult {
  items: PaymentConfigAuditResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
