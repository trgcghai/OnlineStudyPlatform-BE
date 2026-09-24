import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';
import { Request } from 'express';
import { UserRole, UserStatus } from '../../users/entities/user.entity';
import {
  CreateUserDto,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_REGEX,
  UserResponse,
} from '../../users/dto/user.dto';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RegisterDto extends CreateUserDto {}

export class VerifyEmailOtpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}

export class ResendEmailOtpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
}

export class RequestPasswordResetOtpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
}

export class VerifyPasswordResetOtpDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  otp!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  resetToken!: string;

  @Matches(PASSWORD_POLICY_REGEX, {
    message: PASSWORD_POLICY_MESSAGE,
  })
  newPassword!: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti?: string;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  cookies: Record<string, string | undefined>;
}

export interface StoredOtp {
  hash: string;
  email: string;
}

export interface StoredResetOtp extends StoredOtp {
  userId: string;
}

export interface StoredResetToken {
  email: string;
  userId: string;
}

export interface OtpDispatchResult {
  email: string;
  expiresInSeconds: number;
  resendCooldownSeconds: number;
  emailDelivery: 'sent' | 'unavailable';
}

export interface AuthTokenResult {
  accessToken: string;
  refreshToken: string;
  user: UserResponse;
}

export interface RegisterResult extends OtpDispatchResult {
  user: UserResponse;
}

export interface PasswordResetRequestResult extends OtpDispatchResult {
  message: string;
}

export interface PasswordResetVerifyResult {
  resetToken: string;
  expiresInSeconds: number;
}
