import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { UserStatus, UserRole } from '../entities/user.entity';
import {
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_REGEX,
  UserResponse,
} from './user.dto';

export const ADMIN_ASSIGNABLE_ROLES: UserRole[] = [
  UserRole.INSTRUCTOR,
  UserRole.LEARNER,
];

export const ADMIN_MANAGEABLE_STATUSES: UserStatus[] = [
  UserStatus.ACTIVE,
  UserStatus.INACTIVE,
];

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class AdminListUsersQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsIn(ADMIN_ASSIGNABLE_ROLES)
  role?: UserRole;

  @IsOptional()
  @Transform(trimString)
  @IsIn(ADMIN_MANAGEABLE_STATUSES)
  status?: UserStatus;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  q?: string;

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

export class CreateAdminUserDto {
  @IsString()
  @Length(2, 100)
  @Transform(trimString)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  password!: string;

  @IsIn(ADMIN_ASSIGNABLE_ROLES)
  role!: UserRole;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  @Transform(trimString)
  name?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  password?: string;

  @IsOptional()
  @IsIn(ADMIN_ASSIGNABLE_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsIn(ADMIN_MANAGEABLE_STATUSES)
  status?: UserStatus;
}

export interface AdminUserListResult {
  items: UserResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
