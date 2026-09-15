import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalTrimmedString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class UpsertInstructorAccountDto {
  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  bankAccountNumber!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  accountHolderName!: string;

  @Transform(trimString)
  @IsString()
  @Length(1, 120)
  bankCode!: string;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  branchName?: string | null;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  phoneNumber?: string | null;

  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string | null;
}

export interface InstructorAccountResponse {
  id: string;
  instructorId: string;
  bankName: string;
  bankAccountNumber: string;
  accountHolderName: string;
  bankCode: string | null;
  branchName: string | null;
  phoneNumber: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankOptionResponse {
  name: string;
  code: string;
  bin: string;
  shortName: string;
}
