import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { UserRole, UserStatus } from 'src/modules/users/entities/user.entity';

export class CreateUserDto {
  @IsString()
  @Length(2, 100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'Password must be at least 8 characters and include letters, numbers and a special character',
  })
  password!: string;
}

export interface RegisterUserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
