import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { Request } from 'express';
import { UserRole, UserStatus } from '../../users/entities/user.entity';
import { CreateUserDto } from '../../users/dto/user.dto';

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
