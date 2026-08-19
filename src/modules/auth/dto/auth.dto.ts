import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { UserRole, UserStatus } from 'src/modules/users/entities/user.entity';

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

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
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
