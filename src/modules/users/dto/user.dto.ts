import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(2, 100)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, {
    message:
      'Password must be at least 8 characters and include letters, numbers and a special character',
  })
  password: string;
}
